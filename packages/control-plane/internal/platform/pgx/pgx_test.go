package pgx

import (
	"context"
	"testing"
	"time"
)

func TestEscapeILIKE(t *testing.T) {
	// The three ILIKE metacharacters (and the escape char itself) must be
	// escaped so a user substring is matched literally, not as a wildcard.
	cases := map[string]string{
		"plain":      "plain",
		"a%b":        `a\%b`,
		"a_b":        `a\_b`,
		`a\b`:        `a\\b`,
		`100%_\done`: `100\%\_\\done`,
	}
	for in, want := range cases {
		if got := EscapeILIKE(in); got != want {
			t.Fatalf("EscapeILIKE(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNew_BadDSN(t *testing.T) {
	// A DSN that fails pgxpool.ParseConfig surfaces the parse-config error
	// without any network attempt.
	if _, err := New(context.Background(), "://not-a-valid-dsn"); err == nil {
		t.Fatal("malformed DSN must return a parse error")
	}
}

func TestNew_PingFails(t *testing.T) {
	// A well-formed DSN pointing at a dead port: ParseConfig + NewWithConfig
	// succeed (pgxpool connects lazily), the optional PoolConfig tuning is
	// applied, then Ping fails fast and the pool is closed. Exercises every
	// branch of New except the live-DB happy return.
	dsn := "postgres://u:p@127.0.0.1:1/db?connect_timeout=1&sslmode=disable"
	opts := PoolConfig{MaxConns: 4, MinConns: 1, MaxConnLifetime: time.Minute}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := New(ctx, dsn, opts); err == nil {
		t.Fatal("Ping against a dead port must return an error")
	}
}
