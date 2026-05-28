package tls

import (
	"testing"
	"time"
)

func TestNewEngine_GeneratesCA(t *testing.T) {
	e, err := NewEngine(nil, nil, 10, time.Hour)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if e.CACert() == nil {
		t.Fatal("CA cert should not be nil")
	}
	if !e.CACert().IsCA {
		t.Error("CA cert should have IsCA=true")
	}
	pem := e.CACertPEM()
	if len(pem) == 0 {
		t.Error("CA PEM should not be empty")
	}
}
