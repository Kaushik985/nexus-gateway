package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// mockGateway answers chat-completions: SSE when the body asks for stream,
// otherwise a fixed JSON body. Enough to drive the full engine in-process.
func mockGateway() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), `"stream":true`) {
			w.Header().Set("Content-Type", "text/event-stream")
			fl, _ := w.(http.Flusher)
			io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n")
			if fl != nil {
				fl.Flush()
			}
			io.WriteString(w, "data: {\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":1}}\n\n")
			io.WriteString(w, "data: [DONE]\n\n")
			return
		}
		io.WriteString(w, `{"choices":[{"message":{"content":"hi"}}],"usage":{"prompt_tokens":4,"completion_tokens":1}}`)
	}))
}

func runOneStage(t *testing.T, cfg *Config, conc int, dur time.Duration) stageStat {
	t.Helper()
	cfg.Stages = []Stage{{Concurrency: conc, Duration: dur.String()}}
	out, err := cfg.finalize()
	if err != nil {
		t.Fatal(err)
	}
	client := buildClient(out, conc)
	ctx, cancel := context.WithTimeout(context.Background(), dur+5*time.Second)
	defer cancel()
	return runStage(ctx, client, out, 1, out.Stages[0], func(record) {})
}

func TestEngine_NonStream(t *testing.T) {
	srv := mockGateway()
	defer srv.Close()
	cfg := &Config{Warmup: "0s", Timeout: "5s", ThinkTime: "0s",
		Defaults: Defaults{Target: srv.URL, Model: "m", MaxTokens: 8},
		Scenarios: []Scenario{{Name: "s", Weight: 1, Turns: TurnSpec{Min: 1, Max: 1},
			Content: Content{Mode: "pool", Prompts: []string{"hello"}}}}}
	ss := runOneStage(t, cfg, 4, 300*time.Millisecond)
	if ss.Total.Requests == 0 || ss.Total.OK != ss.Total.Requests {
		t.Fatalf("expected all-ok requests, got %+v", ss.Total)
	}
	if ss.Total.CompTok == 0 {
		t.Fatal("completion tokens not parsed from response")
	}
}

func TestEngine_Stream_TTFT(t *testing.T) {
	srv := mockGateway()
	defer srv.Close()
	str := true
	cfg := &Config{Warmup: "0s", Timeout: "5s", ThinkTime: "0s",
		Defaults: Defaults{Target: srv.URL, Model: "m", MaxTokens: 8},
		Scenarios: []Scenario{{Name: "s", Weight: 1, Stream: &str, Turns: TurnSpec{Min: 2, Max: 2},
			Content: Content{Mode: "scripted", Script: []string{"a", "b"}}}}}
	ss := runOneStage(t, cfg, 3, 300*time.Millisecond)
	if ss.Total.Requests == 0 || ss.Total.OK != ss.Total.Requests {
		t.Fatalf("stream: expected all-ok, got %+v", ss.Total)
	}
	if ss.Total.TTFT.P50 <= 0 {
		t.Fatal("TTFT must be measured on the streaming path")
	}
}

// A 200 response with an empty completion (no content, zero tokens) is a
// silent failure — the engine must NOT count it as OK.
func TestEngine_Empty200IsFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Valid JSON shape, HTTP 200, but no content and no usage tokens.
		io.WriteString(w, `{"choices":[{"message":{"content":""}}],"usage":{"prompt_tokens":4,"completion_tokens":0}}`)
	}))
	defer srv.Close()
	cfg := &Config{Warmup: "0s", Timeout: "5s", ThinkTime: "0s",
		Defaults: Defaults{Target: srv.URL, Model: "m", MaxTokens: 8},
		Scenarios: []Scenario{{Name: "s", Weight: 1, Turns: TurnSpec{Min: 1, Max: 1},
			Content: Content{Mode: "pool", Prompts: []string{"hello"}}}}}
	ss := runOneStage(t, cfg, 2, 200*time.Millisecond)
	if ss.Total.Requests == 0 {
		t.Fatal("expected requests to be made")
	}
	if ss.Total.OK != 0 {
		t.Fatalf("empty-200 must not count as OK, got OK=%d/%d", ss.Total.OK, ss.Total.Requests)
	}
	if ss.Total.Errors["empty_completion"] == 0 {
		t.Fatalf("empty-200 must be classified as empty_completion, errors=%+v", ss.Total.Errors)
	}
}

func TestEngine_MultiTurnGrowsContext(t *testing.T) {
	// A 2-turn scenario must send turn 2 with the assistant reply carried
	// forward; the mock echoes "hi", so the engine should complete both turns.
	srv := mockGateway()
	defer srv.Close()
	cfg := &Config{Warmup: "0s", Timeout: "5s", ThinkTime: "0s", CacheMode: "bust",
		Correlation: Correlation{UUIDInPrompt: true, Header: "x-request-id"},
		Defaults:    Defaults{Target: srv.URL, Model: "m", MaxTokens: 8},
		Scenarios: []Scenario{{Name: "s", Weight: 1, Turns: TurnSpec{Min: 2, Max: 2},
			Content: Content{Mode: "scripted", Script: []string{"q1", "q2"}}}}}
	ss := runOneStage(t, cfg, 1, 200*time.Millisecond)
	if ss.Total.Requests < 2 {
		t.Fatalf("multi-turn should produce >=2 turns, got %d", ss.Total.Requests)
	}
}
