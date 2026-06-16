package main

import (
	"errors"
	"testing"
)

func TestPcts(t *testing.T) {
	if (pcts(nil) != Pcts{}) {
		t.Fatal("empty must be zero")
	}
	data := make([]float64, 100) // 1..100
	for i := range data {
		data[i] = float64(i + 1)
	}
	p := pcts(data)
	if p.Min != 1 || p.Max != 100 {
		t.Fatalf("min/max: %+v", p)
	}
	if p.P50 != 50 || p.P90 != 90 || p.P95 != 95 || p.P99 != 99 {
		t.Fatalf("percentiles off: %+v", p)
	}
	if p.Mean != 50.5 {
		t.Fatalf("mean: %v", p.Mean)
	}
}

func TestSampler_Rollup(t *testing.T) {
	s := newSampler()
	// 8 ok @ 100ms (ttft 10), 2 errors
	for i := 0; i < 8; i++ {
		s.add(100, 10, 200, 5, 3, true, nil)
	}
	s.add(0, 0, 0, 0, 0, false, errors.New("connection refused"))
	s.add(0, 0, 0, 0, 0, false, errors.New("dial tcp: cannot assign requested address"))

	st := s.rollup("x", 10, &Thresholds{ErrorRate: 0.5, P95Ms: 200})
	if st.Requests != 10 || st.OK != 8 {
		t.Fatalf("counts: %+v", st)
	}
	if st.ErrorRate < 0.19 || st.ErrorRate > 0.21 {
		t.Fatalf("error rate ~0.2 expected: %v", st.ErrorRate)
	}
	if st.Throughput != 1.0 { // 10 reqs / 10s
		t.Fatalf("throughput: %v", st.Throughput)
	}
	if st.CompTok != 24 || st.OutTokPerS != 2.4 { // 8*3=24 over 10s
		t.Fatalf("tokens: comp=%d tok/s=%v", st.CompTok, st.OutTokPerS)
	}
	if st.Codes["200"] != 8 || st.Errors["conn_refused"] != 1 || st.Errors["gen_port_exhaustion"] != 1 {
		t.Fatalf("codes/errors: %+v %+v", st.Codes, st.Errors)
	}
	if !st.Pass { // err 0.2 <= 0.5 and p95 100 <= 200
		t.Fatal("should pass thresholds")
	}
	// tighten threshold → fail
	st2 := s.rollup("x", 10, &Thresholds{ErrorRate: 0.1})
	if st2.Pass {
		t.Fatal("0.2 error rate must fail a 0.1 threshold")
	}
}

func TestSampler_MergeInto(t *testing.T) {
	a, b := newSampler(), newSampler()
	a.add(50, 5, 200, 1, 1, true, nil)
	b.add(150, 15, 200, 2, 2, true, nil)
	dst := newSampler()
	a.mergeInto(dst)
	b.mergeInto(dst)
	st := dst.rollup("all", 1, &Thresholds{})
	if st.Requests != 2 || st.OK != 2 || st.CompTok != 3 {
		t.Fatalf("merge wrong: %+v", st)
	}
}

func TestClassifyErr(t *testing.T) {
	cases := map[string]string{
		"dial tcp: cannot assign requested address": "gen_port_exhaustion",
		"socket: too many open files":               "gen_fd_exhaustion",
		"context deadline exceeded":                 "timeout",
		"connection refused":                        "conn_refused",
		"connection reset by peer":                  "conn_reset",
		"unexpected EOF":                            "eof",
		"no such host":                              "dns",
		"empty completion body":                     "empty_completion",
		"something weird":                           "other",
	}
	for in, want := range cases {
		if got := classifyErr(in); got != want {
			t.Errorf("classifyErr(%q) = %q, want %q", in, got, want)
		}
	}
}
