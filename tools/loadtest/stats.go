package main

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type Pcts struct{ Min, Mean, P50, P90, P95, P99, Max float64 }

type Stat struct {
	Label      string         `json:"label"`
	Requests   int            `json:"requests"`
	OK         int            `json:"ok"`
	Throughput float64        `json:"throughput_rps"`
	ErrorRate  float64        `json:"error_rate"`
	Lat        Pcts           `json:"latency_ms"`
	TTFT       Pcts           `json:"ttft_ms"`
	PromptTok  int64          `json:"prompt_tokens"`
	CompTok    int64          `json:"completion_tokens"`
	OutTokPerS float64        `json:"output_tokens_per_s"`
	Codes      map[string]int `json:"status_codes"`
	Errors     map[string]int `json:"errors"`
	Pass       bool           `json:"pass"`
}

// sampler collects steady-state turn samples for one (stage, scenario). It is
// the in-memory metrics source of truth — always complete, independent of the
// best-effort JSONL sink.
type sampler struct {
	mu    sync.Mutex
	lat   []float64
	ttft  []float64
	ok    int
	ptok  int64
	ctok  int64
	codes map[string]int
	errs  map[string]int
}

func newSampler() *sampler { return &sampler{codes: map[string]int{}, errs: map[string]int{}} }

func (s *sampler) add(lat, ttft float64, status, ptok, ctok int, ok bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lat = append(s.lat, lat)
	if ttft > 0 {
		s.ttft = append(s.ttft, ttft)
	}
	if err != nil {
		s.errs[classifyErr(err.Error())]++
	} else {
		s.codes[strconv.Itoa(status)]++
	}
	if ok {
		s.ok++
		s.ptok += int64(ptok)
		s.ctok += int64(ctok)
	}
}

func (s *sampler) mergeInto(d *sampler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d.lat = append(d.lat, s.lat...)
	d.ttft = append(d.ttft, s.ttft...)
	d.ok += s.ok
	d.ptok += s.ptok
	d.ctok += s.ctok
	for k, v := range s.codes {
		d.codes[k] += v
	}
	for k, v := range s.errs {
		d.errs[k] += v
	}
}

func (s *sampler) rollup(label string, steadyDur float64, th *Thresholds) Stat {
	s.mu.Lock()
	defer s.mu.Unlock()
	sort.Float64s(s.lat)
	sort.Float64s(s.ttft)
	st := Stat{Label: label, Requests: len(s.lat), OK: s.ok, Codes: s.codes, Errors: s.errs,
		PromptTok: s.ptok, CompTok: s.ctok,
		Throughput: float64(len(s.lat)) / maxF(steadyDur, 0.001),
		ErrorRate:  1 - float64(s.ok)/maxF(float64(len(s.lat)), 1),
		Lat:        pcts(s.lat), TTFT: pcts(s.ttft),
		OutTokPerS: float64(s.ctok) / maxF(steadyDur, 0.001),
	}
	st.Pass = (th.P95Ms == 0 || st.Lat.P95 <= th.P95Ms) &&
		(th.TTFTp95Ms == 0 || st.TTFT.P95 <= th.TTFTp95Ms) &&
		(th.ErrorRate == 0 || st.ErrorRate <= th.ErrorRate)
	return st
}

func pcts(sorted []float64) Pcts {
	if len(sorted) == 0 {
		return Pcts{}
	}
	var sum float64
	for _, v := range sorted {
		sum += v
	}
	q := func(p float64) float64 {
		i := int(math.Ceil(p*float64(len(sorted)))) - 1
		if i < 0 {
			i = 0
		}
		if i >= len(sorted) {
			i = len(sorted) - 1
		}
		return sorted[i]
	}
	return Pcts{Min: sorted[0], Mean: sum / float64(len(sorted)),
		P50: q(.5), P90: q(.9), P95: q(.95), P99: q(.99), Max: sorted[len(sorted)-1]}
}

type stageStat struct {
	Stage       int     `json:"stage"`
	Concurrency int     `json:"concurrency"`
	DurationS   float64 `json:"duration_s"`
	Total       Stat    `json:"total"`
	Scenarios   []Stat  `json:"scenarios"`
}

func classifyErr(e string) string {
	switch {
	case strings.Contains(e, "cannot assign requested address"):
		return "gen_port_exhaustion" // GENERATOR-side, not the server
	case strings.Contains(e, "too many open files"):
		return "gen_fd_exhaustion" // GENERATOR-side
	case strings.Contains(e, "deadline") || strings.Contains(e, "Timeout") || strings.Contains(e, "timeout"):
		return "timeout"
	case strings.Contains(e, "connection refused"):
		return "conn_refused"
	case strings.Contains(e, "reset"):
		return "conn_reset"
	case strings.Contains(e, "EOF"):
		return "eof"
	case strings.Contains(e, "no such host"):
		return "dns"
	case strings.Contains(e, "empty completion"):
		return "empty_completion" // HTTP 200 but no usable payload — silent failure
	default:
		return "other"
	}
}
