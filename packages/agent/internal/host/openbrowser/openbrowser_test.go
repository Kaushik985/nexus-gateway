package openbrowser

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// stubOpenWith replaces the launch seam for the duration of a test and returns
// a pointer to the captured URL plus a restore func.
func stubOpenWith(t *testing.T, ret error) *string {
	t.Helper()
	orig := openWith
	var gotURL string
	openWith = func(goos string, _ context.Context, url string) error {
		gotURL = url
		return ret
	}
	t.Cleanup(func() { openWith = orig })
	return &gotURL
}

// TestOpen_AllowedHTTPSReachesLaunch is the happy path: a well-formed https URL
// to an allowlisted host passes every guard and is handed to the launcher
// verbatim. Asserting the captured URL proves validation didn't mangle it.
func TestOpen_AllowedHTTPSReachesLaunch(t *testing.T) {
	got := stubOpenWith(t, nil)
	o := New()
	o.SetAllowedHosts("cp.example.com")

	if err := o.Open("https://cp.example.com/admin/settings?tab=1"); err != nil {
		t.Fatalf("allowlisted https URL should open, got %v", err)
	}
	if *got != "https://cp.example.com/admin/settings?tab=1" {
		t.Fatalf("launcher received mangled URL: %q", *got)
	}
}

// TestOpen_LauncherErrorPropagates: when the launch seam fails (e.g. xdg-open
// missing), Open surfaces that error rather than swallowing it.
func TestOpen_LauncherErrorPropagates(t *testing.T) {
	stub := errors.New("xdg-open not found")
	stubOpenWith(t, stub)
	o := New()
	o.SetAllowedHosts("cp.example.com")

	if err := o.Open("https://cp.example.com/x"); !errors.Is(err, stub) {
		t.Fatalf("launcher error should propagate, got %v", err)
	}
}

// TestOpen_Rejections pins each security guard: a compromised renderer must not
// be able to open a non-https scheme, an unlisted host, or a malformed URL.
func TestOpen_Rejections(t *testing.T) {
	// Stub so a bug that lets a bad URL through would still not spawn anything;
	// every case here must fail BEFORE the launcher is reached.
	got := stubOpenWith(t, nil)
	o := New()
	o.SetAllowedHosts("cp.example.com")

	cases := []struct {
		name   string
		url    string
		errSub string
	}{
		{"http scheme", "http://cp.example.com/x", "only https"},
		{"ftp scheme", "ftp://cp.example.com/x", "only https"},
		{"no scheme", "cp.example.com/x", "only https"},
		{"missing host", "https:///just/a/path", "missing host"},
		{"host not allowlisted", "https://evil.example.net/x", "not in allowlist"},
		{"malformed url", "https://%zz", "parse url"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			*got = ""
			err := o.Open(tc.url)
			if err == nil {
				t.Fatalf("%q should be rejected", tc.url)
			}
			if !strings.Contains(err.Error(), tc.errSub) {
				t.Fatalf("error for %q = %q, want substring %q", tc.url, err, tc.errSub)
			}
			if *got != "" {
				t.Fatalf("rejected URL %q must never reach the launcher (got %q)", tc.url, *got)
			}
		})
	}
}

// TestOpen_HostMatchIsCaseInsensitive: the allowlist is normalised, so a host
// configured in mixed case still matches a request in any case.
func TestOpen_HostMatchIsCaseInsensitive(t *testing.T) {
	stubOpenWith(t, nil)
	o := New()
	o.SetAllowedHosts("  CP.Example.COM  ")
	if err := o.Open("https://cp.EXAMPLE.com/x"); err != nil {
		t.Fatalf("case/space-normalised host should match, got %v", err)
	}
}

// TestSetAllowedHosts_NormalisesAndReplaces: empty/whitespace entries are
// dropped, and a second call replaces (not appends to) the set.
func TestSetAllowedHosts_NormalisesAndReplaces(t *testing.T) {
	stubOpenWith(t, nil)
	o := New()

	// Empty initial allowlist rejects everything.
	if err := o.Open("https://a.example.com/x"); err == nil {
		t.Fatal("empty allowlist should reject all hosts")
	}

	o.SetAllowedHosts("a.example.com", "  ", "")
	if err := o.Open("https://a.example.com/x"); err != nil {
		t.Fatalf("a.example.com should be allowed, got %v", err)
	}

	// Replace: a.example.com must no longer be allowed; b is.
	o.SetAllowedHosts("b.example.com")
	if err := o.Open("https://a.example.com/x"); err == nil {
		t.Fatal("SetAllowedHosts must replace, not append (a should be gone)")
	}
	if err := o.Open("https://b.example.com/x"); err != nil {
		t.Fatalf("b.example.com should be allowed after replace, got %v", err)
	}
}

// TestBuildBrowserCmd covers every OS arm, including the unsupported-OS
// rejection, by passing goos explicitly.
func TestBuildBrowserCmd(t *testing.T) {
	ctx := context.Background()
	const url = "https://cp.example.com/x"
	cases := []struct {
		goos     string
		wantLast string // last arg is always the URL
		wantBin  string // command basename
	}{
		{"darwin", url, "open"},
		{"linux", url, "xdg-open"},
		{"windows", url, "rundll32"},
	}
	for _, tc := range cases {
		t.Run(tc.goos, func(t *testing.T) {
			cmd, err := buildBrowserCmd(tc.goos, ctx, url)
			if err != nil {
				t.Fatalf("buildBrowserCmd(%s) error: %v", tc.goos, err)
			}
			if !strings.Contains(cmd.Path, tc.wantBin) && filepathBase(cmd.Args[0]) != tc.wantBin {
				t.Fatalf("%s: command = %q, want %q", tc.goos, cmd.Args[0], tc.wantBin)
			}
			if cmd.Args[len(cmd.Args)-1] != tc.wantLast {
				t.Fatalf("%s: last arg = %q, want URL %q", tc.goos, cmd.Args[len(cmd.Args)-1], tc.wantLast)
			}
		})
	}

	t.Run("unsupported", func(t *testing.T) {
		_, err := buildBrowserCmd("plan9", ctx, url)
		if err == nil || !strings.Contains(err.Error(), "unsupported OS") {
			t.Fatalf("plan9 should be rejected, got %v", err)
		}
	})
}

// TestRealOpen_UnsupportedOS exercises realOpen's error path (build fails →
// return before any spawn). The success path's cmd.Start() is the one line not
// unit-tested, as it would launch a real browser.
func TestRealOpen_UnsupportedOS(t *testing.T) {
	if err := realOpen("plan9", context.Background(), "https://cp.example.com/x"); err == nil ||
		!strings.Contains(err.Error(), "unsupported OS") {
		t.Fatalf("realOpen unsupported OS should error, got %v", err)
	}
}

// filepathBase avoids importing path/filepath just for a basename in one assert.
func filepathBase(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}
