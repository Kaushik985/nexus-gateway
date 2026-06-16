package main

import (
	"bufio"
	"encoding/json"
	"io"
	"strings"
)

func init() { Register("anthropic", func() Protocol { return anthropic{} }) }

// anthropic speaks the Anthropic Messages wire format (/v1/messages): the system
// prompt is a top-level field (not a message), the reply is a content-block
// array, and the stream is named SSE events rather than data:/[DONE].
//
// Note: a real Anthropic endpoint also needs an `anthropic-version` header —
// set it in the scenario's `headers` config (kept out of code by design).
type anthropic struct{}

func (anthropic) Name() string { return "anthropic" }
func (anthropic) Path() string { return "/v1/messages" }

func (anthropic) BuildBody(c Conversation) ([]byte, error) {
	msgs := make([]map[string]string, 0, len(c.Msgs))
	for _, m := range c.Msgs {
		// Anthropic messages carry only user/assistant; system is top-level.
		if m.Role == "system" {
			continue
		}
		msgs = append(msgs, map[string]string{"role": m.Role, "content": m.Content})
	}
	p := map[string]any{"model": c.Model, "messages": msgs, "max_tokens": c.MaxTokens}
	if c.System != "" {
		p["system"] = c.System
	}
	if c.Stream {
		p["stream"] = true
	}
	return json.Marshal(p)
}

func (anthropic) ParseNonStream(b []byte) (Turn, error) {
	var r struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return Turn{}, err
	}
	t := Turn{PromptTokens: r.Usage.InputTokens, CompletionTokens: r.Usage.OutputTokens}
	var sb strings.Builder
	for _, blk := range r.Content {
		if blk.Type == "text" {
			sb.WriteString(blk.Text)
		}
	}
	t.Content = sb.String()
	return t, nil
}

func (anthropic) ParseStream(r io.Reader) (Turn, error) {
	var sb strings.Builder
	var t Turn
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue // ignore the "event:" lines; the JSON carries its own "type"
		}
		data := strings.TrimSpace(line[len("data:"):])
		var ev struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
			Message struct {
				Usage struct {
					InputTokens int `json:"input_tokens"`
				} `json:"usage"`
			} `json:"message"`
			Usage struct {
				OutputTokens int `json:"output_tokens"`
			} `json:"usage"`
		}
		if json.Unmarshal([]byte(data), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "content_block_delta":
			if ev.Delta.Type == "text_delta" || ev.Delta.Text != "" {
				sb.WriteString(ev.Delta.Text)
			}
		case "message_start":
			if ev.Message.Usage.InputTokens > 0 {
				t.PromptTokens = ev.Message.Usage.InputTokens
			}
		case "message_delta":
			if ev.Usage.OutputTokens > 0 {
				t.CompletionTokens = ev.Usage.OutputTokens
			}
		case "message_stop":
			t.Content = sb.String()
			return t, nil
		}
	}
	t.Content = sb.String()
	return t, sc.Err()
}
