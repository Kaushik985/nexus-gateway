package main

import (
	"bufio"
	"encoding/json"
	"io"
	"strings"
)

func init() { Register("openai-chat", func() Protocol { return openaiChat{} }) }

// openaiChat speaks the OpenAI Chat Completions wire format
// (/v1/chat/completions) — the de-facto default for most gateways.
type openaiChat struct{}

func (openaiChat) Name() string { return "openai-chat" }
func (openaiChat) Path() string { return "/v1/chat/completions" }

func (openaiChat) BuildBody(c Conversation) ([]byte, error) {
	msgs := make([]map[string]string, 0, len(c.Msgs)+1)
	if c.System != "" {
		msgs = append(msgs, map[string]string{"role": "system", "content": c.System})
	}
	for _, m := range c.Msgs {
		msgs = append(msgs, map[string]string{"role": m.Role, "content": m.Content})
	}
	p := map[string]any{"model": c.Model, "messages": msgs, "max_tokens": c.MaxTokens}
	if c.Stream {
		p["stream"] = true
		p["stream_options"] = map[string]any{"include_usage": true}
	}
	return json.Marshal(p)
}

func (openaiChat) ParseNonStream(b []byte) (Turn, error) {
	var r struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return Turn{}, err
	}
	t := Turn{PromptTokens: r.Usage.PromptTokens, CompletionTokens: r.Usage.CompletionTokens}
	if len(r.Choices) > 0 {
		t.Content = r.Choices[0].Message.Content
	}
	return t, nil
}

func (openaiChat) ParseStream(r io.Reader) (Turn, error) {
	var sb strings.Builder
	var t Turn
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(line[len("data:"):])
		if data == "[DONE]" {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Usage struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			} `json:"usage"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		if len(chunk.Choices) > 0 {
			sb.WriteString(chunk.Choices[0].Delta.Content)
		}
		if chunk.Usage.PromptTokens > 0 {
			t.PromptTokens = chunk.Usage.PromptTokens
		}
		if chunk.Usage.CompletionTokens > 0 {
			t.CompletionTokens = chunk.Usage.CompletionTokens
		}
	}
	t.Content = sb.String()
	return t, sc.Err()
}
