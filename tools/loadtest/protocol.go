package main

import (
	"fmt"
	"io"
	"sort"
)

// Msg is one normalized chat turn, protocol-independent.
type Msg struct {
	Role    string // "user" | "assistant" | "system"
	Content string
}

// Conversation is the normalized request the engine hands to a protocol; the
// adapter translates it to and from the provider's wire format.
type Conversation struct {
	Model     string
	System    string
	Msgs      []Msg
	MaxTokens int
	Stream    bool
}

// Turn is the normalized result of one request.
type Turn struct {
	Content          string
	PromptTokens     int
	CompletionTokens int
}

// Protocol is the ONLY place a wire format lives. Add a provider by writing one
// file that implements this and self-registers in init() — the engine, sink,
// and reporter never change.
type Protocol interface {
	Name() string
	Path() string // default endpoint path, e.g. "/v1/chat/completions"
	BuildBody(Conversation) ([]byte, error)
	ParseNonStream([]byte) (Turn, error)
	ParseStream(io.Reader) (Turn, error) // consumes an SSE body; owns its event format
}

var registry = map[string]func() Protocol{}

// Register wires a protocol adapter by name. Called from each adapter's init().
func Register(name string, ctor func() Protocol) { registry[name] = ctor }

// GetProtocol returns the adapter for name, or an error listing the known ones.
func GetProtocol(name string) (Protocol, error) {
	if ctor, ok := registry[name]; ok {
		return ctor(), nil
	}
	known := make([]string, 0, len(registry))
	for k := range registry {
		known = append(known, k)
	}
	sort.Strings(known)
	return nil, fmt.Errorf("unknown protocol %q (known: %v)", name, known)
}
