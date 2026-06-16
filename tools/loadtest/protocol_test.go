package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOpenAIChat_BuildBody(t *testing.T) {
	p := openaiChat{}
	b, err := p.BuildBody(Conversation{Model: "m", System: "sys", Msgs: []Msg{{"user", "hi"}}, MaxTokens: 7, Stream: true})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if got["model"] != "m" || got["max_tokens"].(float64) != 7 {
		t.Fatalf("model/max_tokens wrong: %v", got)
	}
	if got["stream"] != true || got["stream_options"] == nil {
		t.Fatalf("stream flags missing: %v", got)
	}
	msgs := got["messages"].([]any)
	if len(msgs) != 2 || msgs[0].(map[string]any)["role"] != "system" {
		t.Fatalf("system not prepended: %v", msgs)
	}
	// non-stream must NOT carry stream fields
	b2, _ := p.BuildBody(Conversation{Model: "m", Msgs: []Msg{{"user", "hi"}}, MaxTokens: 1})
	if strings.Contains(string(b2), "stream") {
		t.Fatalf("non-stream body leaked stream field: %s", b2)
	}
}

func TestOpenAIChat_ParseNonStream(t *testing.T) {
	body := `{"choices":[{"message":{"content":"hello world"}}],"usage":{"prompt_tokens":12,"completion_tokens":3}}`
	turn, err := openaiChat{}.ParseNonStream([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if turn.Content != "hello world" || turn.PromptTokens != 12 || turn.CompletionTokens != 3 {
		t.Fatalf("parsed wrong: %+v", turn)
	}
}

func TestOpenAIChat_ParseStream(t *testing.T) {
	sse := strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"Hel"}}]}`,
		`data: {"choices":[{"delta":{"content":"lo"}}]}`,
		`data: {"usage":{"prompt_tokens":5,"completion_tokens":2}}`,
		`data: [DONE]`,
	}, "\n")
	turn, err := openaiChat{}.ParseStream(strings.NewReader(sse))
	if err != nil {
		t.Fatal(err)
	}
	if turn.Content != "Hello" {
		t.Fatalf("stream content = %q, want Hello", turn.Content)
	}
	if turn.PromptTokens != 5 || turn.CompletionTokens != 2 {
		t.Fatalf("stream usage wrong: %+v", turn)
	}
}

// OpenAI's spec-compliant streaming with stream_options.include_usage emits
// "usage": null in every chunk EXCEPT the final one. A naive parser that
// dereferences usage on each chunk breaks on the null; the value-struct decode
// must absorb null as the zero value and still pick up the final real usage.
func TestOpenAIChat_ParseStream_NullUsageUntilFinal(t *testing.T) {
	sse := strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"Hel"}}],"usage":null}`,
		`data: {"choices":[{"delta":{"content":"lo"}}],"usage":null}`,
		`data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}`,
		`data: [DONE]`,
	}, "\n")
	turn, err := openaiChat{}.ParseStream(strings.NewReader(sse))
	if err != nil {
		t.Fatalf("null usage in intermediate chunks must not error: %v", err)
	}
	if turn.Content != "Hello" {
		t.Fatalf("content = %q, want Hello", turn.Content)
	}
	if turn.PromptTokens != 7 || turn.CompletionTokens != 2 {
		t.Fatalf("final-chunk usage not picked up: %+v", turn)
	}
}

func TestAnthropic_BuildBody(t *testing.T) {
	b, err := anthropic{}.BuildBody(Conversation{Model: "claude", System: "sys",
		Msgs: []Msg{{"system", "ignored"}, {"user", "hi"}}, MaxTokens: 9, Stream: true})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	json.Unmarshal(b, &got)
	if got["system"] != "sys" {
		t.Fatalf("system should be top-level: %v", got)
	}
	msgs := got["messages"].([]any)
	if len(msgs) != 1 || msgs[0].(map[string]any)["role"] != "user" {
		t.Fatalf("system msg must be dropped from messages: %v", msgs)
	}
	if got["stream"] != true {
		t.Fatalf("stream not set: %v", got)
	}
}

func TestAnthropic_ParseNonStream(t *testing.T) {
	body := `{"content":[{"type":"text","text":"abc"},{"type":"text","text":"def"}],"usage":{"input_tokens":8,"output_tokens":4}}`
	turn, err := anthropic{}.ParseNonStream([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if turn.Content != "abcdef" || turn.PromptTokens != 8 || turn.CompletionTokens != 4 {
		t.Fatalf("parsed wrong: %+v", turn)
	}
}

func TestAnthropic_ParseStream(t *testing.T) {
	sse := strings.Join([]string{
		`event: message_start`,
		`data: {"type":"message_start","message":{"usage":{"input_tokens":11}}}`,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}`,
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}`,
		`event: message_delta`,
		`data: {"type":"message_delta","usage":{"output_tokens":6}}`,
		`event: message_stop`,
		`data: {"type":"message_stop"}`,
	}, "\n")
	turn, err := anthropic{}.ParseStream(strings.NewReader(sse))
	if err != nil {
		t.Fatal(err)
	}
	if turn.Content != "Hi there" {
		t.Fatalf("content = %q, want 'Hi there'", turn.Content)
	}
	if turn.PromptTokens != 11 || turn.CompletionTokens != 6 {
		t.Fatalf("usage wrong: %+v", turn)
	}
}

func TestRegistry(t *testing.T) {
	if _, err := GetProtocol("openai-chat"); err != nil {
		t.Fatalf("openai-chat must be registered: %v", err)
	}
	if _, err := GetProtocol("anthropic"); err != nil {
		t.Fatalf("anthropic must be registered: %v", err)
	}
	if _, err := GetProtocol("nope"); err == nil {
		t.Fatal("unknown protocol must error")
	}
}
