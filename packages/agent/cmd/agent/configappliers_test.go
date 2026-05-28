package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/AlphaBitCore/nexus-gateway/packages/agent/internal/policy/policies"
)

// fakeShadowApplier records the raw it was handed and returns a configurable error.
type fakeShadowApplier struct {
	gotRaw json.RawMessage
	err    error
}

func (f *fakeShadowApplier) ApplyShadowState(_ context.Context, raw json.RawMessage) error {
	f.gotRaw = raw
	return f.err
}

func TestApplyOf(t *testing.T) {
	fa := &fakeShadowApplier{}
	ra := applyOf(fa)
	// rawApply always returns nil bytes (appliers are side-effecting) and
	// forwards the raw + propagates the applier's error.
	out, err := ra(context.Background(), []byte(`{"x":1}`), 7)
	if out != nil || err != nil || string(fa.gotRaw) != `{"x":1}` {
		t.Fatalf("applyOf happy: out=%v err=%v gotRaw=%s", out, err, fa.gotRaw)
	}
	fa.err = errors.New("apply boom")
	if _, err := ra(context.Background(), []byte(`{}`), 8); err == nil {
		t.Fatal("applyOf must propagate the applier error")
	}
}

func TestAdaptApplyFunc(t *testing.T) {
	var gotRaw json.RawMessage
	sentinel := errors.New("fn boom")
	ra := adaptApplyFunc(func(_ context.Context, raw json.RawMessage) error {
		gotRaw = raw
		return sentinel
	})
	out, err := ra(context.Background(), []byte(`{"k":2}`), 1)
	if out != nil || !errors.Is(err, sentinel) || string(gotRaw) != `{"k":2}` {
		t.Fatalf("adaptApplyFunc: out=%v err=%v gotRaw=%s", out, err, gotRaw)
	}
}

func TestTeeCatB(t *testing.T) {
	inner := &fakeShadowApplier{}
	applier := teeCatB("hooks", inner, nil)
	tee, ok := applier.(policies.TeeApplier)
	if !ok {
		t.Fatalf("teeCatB must return a policies.TeeApplier, got %T", applier)
	}
	if tee.CfgKey != "hooks" || tee.Inner != inner {
		t.Fatalf("teeCatB wiring wrong: %+v", tee)
	}
}
