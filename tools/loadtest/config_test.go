package main

import (
	"encoding/json"
	"math/rand"
	"strings"
	"testing"
)

func TestTurnSpec_Unmarshal(t *testing.T) {
	var a TurnSpec
	if json.Unmarshal([]byte(`5`), &a); a.Min != 5 || a.Max != 5 {
		t.Fatalf("int form: %+v", a)
	}
	var b TurnSpec
	if json.Unmarshal([]byte(`{"min":2,"max":4}`), &b); b.Min != 2 || b.Max != 4 {
		t.Fatalf("range form: %+v", b)
	}
}

func TestTurnSpec_Pick(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	zero := TurnSpec{}
	if zero.pick(r) != 1 {
		t.Fatal("unset turns must default to 1")
	}
	rng := TurnSpec{Min: 3, Max: 6}
	for i := 0; i < 50; i++ {
		n := rng.pick(r)
		if n < 3 || n > 6 {
			t.Fatalf("pick out of range: %d", n)
		}
	}
}

func TestFinalize_DefaultsAndFallback(t *testing.T) {
	cfg := Config{
		Defaults: Defaults{Target: "http://x/v1/chat/completions", Headers: map[string]string{"Authorization": "Bearer t"}, Model: "m"},
		Stages:   []Stage{{Concurrency: 2, Duration: "1s"}},
		Warmup:   "0s", Timeout: "5s", ThinkTime: "0s",
	}
	out, err := cfg.finalize()
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Scenarios) != 1 || out.Scenarios[0].Name != "default" {
		t.Fatalf("expected single implicit scenario, got %+v", out.Scenarios)
	}
	s := out.Scenarios[0]
	if s.Protocol != "openai-chat" || s.proto == nil {
		t.Fatalf("protocol not resolved: %+v", s)
	}
	if s.Target != "http://x/v1/chat/completions" || s.Model != "m" || s.MaxTokens != 64 {
		t.Fatalf("defaults not propagated: %+v", s)
	}
	if s.Headers["Authorization"] != "Bearer t" {
		t.Fatalf("headers not merged: %+v", s.Headers)
	}
}

func TestFinalize_MissingTarget(t *testing.T) {
	cfg := Config{Stages: []Stage{{Concurrency: 1, Duration: "1s"}}, Warmup: "0s", Timeout: "5s", ThinkTime: "0s"}
	if _, err := cfg.finalize(); err == nil {
		t.Fatal("missing target must error")
	}
}

func TestFinalize_HeaderOverride(t *testing.T) {
	tru := true
	cfg := Config{
		Defaults: Defaults{Target: "http://x", Headers: map[string]string{"Authorization": "Bearer d", "X-Keep": "1"}},
		Stages:   []Stage{{Concurrency: 1, Duration: "1s"}},
		Warmup:   "0s", Timeout: "5s", ThinkTime: "0s",
		Scenarios: []Scenario{{Name: "s", Headers: map[string]string{"Authorization": "Bearer o"}, Stream: &tru, Content: Content{Mode: "pool", Prompts: []string{"p"}}}},
	}
	out, err := cfg.finalize()
	if err != nil {
		t.Fatal(err)
	}
	h := out.Scenarios[0].Headers
	if h["Authorization"] != "Bearer o" || h["X-Keep"] != "1" {
		t.Fatalf("scenario should override Authorization but keep X-Keep: %+v", h)
	}
}

func TestUserContent(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	pool := Scenario{Content: Content{Mode: "pool", Prompts: []string{"only"}}}
	if pool.userContent(0, r) != "only" {
		t.Fatal("pool")
	}
	scr := Scenario{Content: Content{Mode: "scripted", Script: []string{"a", "b"}}}
	if scr.userContent(0, r) != "a" || scr.userContent(1, r) != "b" || scr.userContent(2, r) != "a" {
		t.Fatal("scripted should index+wrap by turn")
	}
	sized := Scenario{Content: Content{Mode: "sized", ApproxInputToks: 100}}
	got := sized.userContent(0, r)
	if len(got) < 300 || !strings.Contains(got, "Summarize") {
		t.Fatalf("sized prompt too short / missing tail: len=%d", len(got))
	}
}

func TestAllocate(t *testing.T) {
	scs := []Scenario{{Name: "a", Weight: 70}, {Name: "b", Weight: 20}, {Name: "c", Weight: 10}}
	got := allocate(1000, scs)
	if len(got) != 1000 {
		t.Fatalf("must assign exactly 1000 VUs, got %d", len(got))
	}
	counts := map[int]int{}
	for _, idx := range got {
		counts[idx]++
	}
	if counts[0] != 700 || counts[1] != 200 || counts[2] != 100 {
		t.Fatalf("weight split wrong: %v (want 700/200/100)", counts)
	}
	// small pool still totals correctly
	if g := allocate(3, scs); len(g) != 3 {
		t.Fatalf("small total: %d", len(g))
	}
}
