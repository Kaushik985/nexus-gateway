package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func writeReports(outDir, stamp string, cfg *Config, stages []stageStat, resultsPath string, sinkDropped int64, fdHave uint64, fdWarn string) {
	var b strings.Builder
	line := strings.Repeat("=", 100)
	sub := strings.Repeat("-", 100)

	fmt.Fprintf(&b, "%s\n LLM GATEWAY LOAD TEST REPORT\n%s\n", line, line)
	fmt.Fprintf(&b, " Generated : %s\n", time.Now().UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, " Model     : closed (fixed concurrency per stage; weight = share of the VU pool)\n")
	fmt.Fprintf(&b, " Warmup    : %s excluded from steady-state stats\n", cfg.Warmup)
	fmt.Fprintf(&b, " Cache     : mode=%s (UUID-front cache-bust threads each conversation + joins server records)\n", cfg.CacheMode)
	fmt.Fprintf(&b, " Scenarios :")
	for _, s := range cfg.Scenarios {
		streamS := "non-stream"
		if s.Stream != nil && *s.Stream {
			streamS = "stream"
		}
		fmt.Fprintf(&b, " %s(w=%d,%s,%s,%s)", s.Name, s.Weight, s.Protocol, streamS, s.Content.Mode)
	}
	fmt.Fprintf(&b, "\n Raw       : %s\n", filepath.Base(resultsPath))

	totalReq, totalOK := 0, 0
	var totalCompTok int64
	genErrs := map[string]int{}
	allPass := true

	for _, ss := range stages {
		fmt.Fprintf(&b, "%s\n STAGE %d  —  concurrency %d  for %.0fs\n%s\n", sub, ss.Stage, ss.Concurrency, ss.DurationS, sub)
		fmt.Fprintf(&b, " %-12s %8s %8s %6s | %8s %8s %8s | %8s %8s | %8s  %s\n",
			"scenario", "reqs", "rps", "ok%", "lat_p50", "lat_p95", "lat_p99", "ttft_p50", "ttft_p95", "out_tok/s", "codes/errors")
		printStat := func(s Stat) {
			fmt.Fprintf(&b, " %-12s %8d %8.1f %5.1f | %8.0f %8.0f %8.0f | %8.0f %8.0f | %8.1f  %s\n",
				trunc(s.Label, 12), s.Requests, s.Throughput, 100*float64(s.OK)/maxF(float64(s.Requests), 1),
				s.Lat.P50, s.Lat.P95, s.Lat.P99, s.TTFT.P50, s.TTFT.P95, s.OutTokPerS, codesStr(s))
		}
		for _, sc := range ss.Scenarios {
			if sc.Requests == 0 {
				continue
			}
			printStat(sc)
		}
		if len(ss.Scenarios) > 1 {
			printStat(ss.Total)
		}
		totalReq += ss.Total.Requests
		totalOK += ss.Total.OK
		totalCompTok += ss.Total.CompTok
		for k, v := range ss.Total.Errors {
			if strings.HasPrefix(k, "gen_") {
				genErrs[k] += v
			}
		}
		if !ss.Total.Pass {
			allPass = false
		}
	}

	fmt.Fprintf(&b, "%s\n AGGREGATE\n%s\n", sub, sub)
	fmt.Fprintf(&b, " Total turns      : %d   (successful %d, %.2f%%)\n", totalReq, totalOK, 100*float64(totalOK)/maxF(float64(totalReq), 1))
	fmt.Fprintf(&b, " Completion tokens: %d\n", totalCompTok)
	fmt.Fprintf(&b, " (latencies in ms; per-stage percentiles above are the meaningful view for a step test)\n")

	fmt.Fprintf(&b, "%s\n GENERATOR HEALTH (is the load tester itself the bottleneck?)\n%s\n", sub, sub)
	fmt.Fprintf(&b, " FD limit (this host) : %d%s\n", fdHave, ifWarn(fdWarn))
	fmt.Fprintf(&b, " JSONL records dropped: %d %s\n", sinkDropped, ifNonZero(sinkDropped, "(sink overflowed — stats unaffected; raise buffer / slow rate)"))
	if len(genErrs) == 0 {
		fmt.Fprintf(&b, " Generator-side errors: none (port/FD exhaustion not observed → results reflect the SERVER, not the generator)\n")
	} else {
		fmt.Fprintf(&b, " Generator-side errors: %v  ← these are HARNESS limits, not server faults; scale out / raise limits\n", genErrs)
	}

	fmt.Fprintf(&b, "%s\n THRESHOLDS\n%s\n", sub, sub)
	if cfg.Thresholds == (Thresholds{}) {
		fmt.Fprintf(&b, " (none configured)\n")
	} else {
		if cfg.Thresholds.P95Ms > 0 {
			fmt.Fprintf(&b, " lat p95 <= %.0f ms ; ", cfg.Thresholds.P95Ms)
		}
		if cfg.Thresholds.TTFTp95Ms > 0 {
			fmt.Fprintf(&b, "ttft p95 <= %.0f ms ; ", cfg.Thresholds.TTFTp95Ms)
		}
		if cfg.Thresholds.ErrorRate > 0 {
			fmt.Fprintf(&b, "error rate <= %.2f%%", 100*cfg.Thresholds.ErrorRate)
		}
		fmt.Fprintf(&b, "\n")
		for _, ss := range stages {
			fmt.Fprintf(&b, "   stage %d (conc %d): %s\n", ss.Stage, ss.Concurrency, passStr(ss.Total.Pass))
		}
		fmt.Fprintf(&b, " OVERALL: %s\n", passStr(allPass))
	}
	fmt.Fprintf(&b, "%s\n", line)

	reportPath := filepath.Join(outDir, "report-"+stamp+".txt")
	must(os.WriteFile(reportPath, []byte(b.String()), 0o644), "write report")

	summary := map[string]any{
		"generated":  time.Now().UTC().Format(time.RFC3339),
		"cache_mode": cfg.CacheMode, "warmup": cfg.Warmup, "results_file": filepath.Base(resultsPath),
		"stages": stages,
		"generator_health": map[string]any{
			"fd_limit": fdHave, "fd_warning": fdWarn, "sink_dropped": sinkDropped, "generator_errors": genErrs,
		},
		"aggregate": map[string]any{"total_turns": totalReq, "successful": totalOK, "completion_tokens": totalCompTok},
		"pass":      allPass,
	}
	sj, _ := json.MarshalIndent(summary, "", "  ")
	must(os.WriteFile(filepath.Join(outDir, "summary-"+stamp+".json"), sj, 0o644), "write summary")

	fmt.Print("\n" + b.String())
	fmt.Printf("report : %s\nsummary: %s\n", reportPath, filepath.Join(outDir, "summary-"+stamp+".json"))
}

func codesStr(s Stat) string {
	parts := []string{}
	for k, v := range s.Codes {
		parts = append(parts, fmt.Sprintf("%s:%d", k, v))
	}
	for k, v := range s.Errors {
		parts = append(parts, fmt.Sprintf("%s:%d", k, v))
	}
	sort.Strings(parts)
	return strings.Join(parts, " ")
}
func trunc(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
func passStr(p bool) string {
	if p {
		return "PASS"
	}
	return "FAIL"
}
func ifWarn(w string) string {
	if w != "" {
		return "  ⚠ " + w
	}
	return ""
}
func ifNonZero(n int64, msg string) string {
	if n > 0 {
		return msg
	}
	return ""
}
