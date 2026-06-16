package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestParseStagesFlag(t *testing.T) {
	got := parseStagesFlag("1:10s, 100:60s ,1000:2m")
	if len(got) != 3 {
		t.Fatalf("want 3 stages, got %d", len(got))
	}
	if got[0].Concurrency != 1 || got[0].Duration != "10s" {
		t.Fatalf("stage0: %+v", got[0])
	}
	if got[2].Concurrency != 1000 || got[2].Duration != "2m" {
		t.Fatalf("stage2: %+v", got[2])
	}
}

func TestCloneWith(t *testing.T) {
	base := map[string]string{"A": "1"}
	out := cloneWith(base, "B", "2")
	if out["A"] != "1" || out["B"] != "2" {
		t.Fatalf("clone wrong: %+v", out)
	}
	if _, ok := base["B"]; ok {
		t.Fatal("cloneWith mutated the source map")
	}
}

func TestBuildClient(t *testing.T) {
	cfg := &Config{timeout: 0, DisableKeepAlive: true}
	c := buildClient(cfg, 500)
	tr := c.Transport.(*http.Transport)
	if tr.MaxIdleConnsPerHost < 500 {
		t.Fatalf("idle conns per host must cover peak concurrency: %d", tr.MaxIdleConnsPerHost)
	}
	if !tr.DisableKeepAlives {
		t.Fatal("DisableKeepAlive not honored")
	}
}

func TestWriteReports(t *testing.T) {
	dir := t.TempDir()
	str := false
	cfg := &Config{CacheMode: "bust", Warmup: "0s", Thresholds: Thresholds{P95Ms: 100},
		Scenarios: []Scenario{{Name: "s", Weight: 1, Protocol: "openai-chat", Stream: &str, Content: Content{Mode: "pool"}}}}
	mk := func(label string, p95 float64, pass bool) Stat {
		return Stat{Label: label, Requests: 100, OK: 100, Throughput: 10,
			Lat: Pcts{P50: 50, P95: p95}, TTFT: Pcts{P50: 5, P95: 9},
			Codes: map[string]int{"200": 100}, Errors: map[string]int{}, Pass: pass}
	}
	stages := []stageStat{{Stage: 1, Concurrency: 10, DurationS: 10,
		Total: mk("ALL", 90, true), Scenarios: []Stat{mk("s", 90, true)}}}

	writeReports(dir, "ts", cfg, stages, "results-ts.jsonl", 0, 1024, "")

	rep := filepath.Join(dir, "report-ts.txt")
	if _, err := os.Stat(rep); err != nil {
		t.Fatalf("report.txt not written: %v", err)
	}
	sj, err := os.ReadFile(filepath.Join(dir, "summary-ts.json"))
	if err != nil {
		t.Fatalf("summary.json not written: %v", err)
	}
	var sum map[string]any
	if err := json.Unmarshal(sj, &sum); err != nil {
		t.Fatalf("summary.json not valid JSON: %v", err)
	}
	if sum["pass"] != true {
		t.Fatalf("summary pass should be true: %v", sum["pass"])
	}
	agg := sum["aggregate"].(map[string]any)
	if agg["total_turns"].(float64) != 100 {
		t.Fatalf("aggregate total_turns wrong: %v", agg["total_turns"])
	}
}
