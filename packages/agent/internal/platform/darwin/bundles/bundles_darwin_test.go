//go:build darwin

package bundles

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestExtractPlistString(t *testing.T) {
	body := `<key>CFBundleVersion</key>
		<string>  42  </string>`
	if got := extractPlistString(body, "CFBundleVersion"); got != "42" {
		t.Fatalf("extractPlistString = %q, want 42", got)
	}
	if got := extractPlistString(body, "Nope"); got != "" {
		t.Fatalf("missing key = %q, want empty", got)
	}
	if got := extractPlistString(`<key>K</key> no string`, "K"); got != "" {
		t.Fatalf("malformed = %q, want empty", got)
	}
}

func TestReadBundleStamp(t *testing.T) {
	// Empty path → "not found".
	if s := readBundleStamp("", ""); s.Note != "not found on disk" {
		t.Fatalf("empty path note = %q", s.Note)
	}
	// Non-existent path → stat failed.
	if s := readBundleStamp("/no/such/Info.plist", ""); s.Note == "" {
		t.Fatal("missing path must set a stat-failed note")
	}
	// A directory path → stat succeeds but ReadFile fails → read-failed note.
	if s := readBundleStamp(t.TempDir(), ""); s.Mtime == "" || s.Note == "" {
		t.Fatalf("directory path must stat-ok then read-fail: %+v", s)
	}
	// Real plist with both keys.
	dir := t.TempDir()
	p := filepath.Join(dir, "Info.plist")
	_ = os.WriteFile(p, []byte(`<plist><dict>
		<key>CFBundleShortVersionString</key><string>1.2.3</string>
		<key>CFBundleVersion</key><string>456</string>
		</dict></plist>`), 0o644)
	s := readBundleStamp(p, "note")
	if s.CFBundleShortVersion != "1.2.3" || s.CFBundleVersion != "456" || s.Mtime == "" {
		t.Fatalf("readBundleStamp parse: %+v", s)
	}
	// Plist missing the keys → "<missing>" sentinels.
	pEmpty := filepath.Join(dir, "Empty.plist")
	_ = os.WriteFile(pEmpty, []byte(`<plist><dict></dict></plist>`), 0o644)
	s2 := readBundleStamp(pEmpty, "")
	if s2.CFBundleVersion != "<missing>" || s2.CFBundleShortVersion != "<missing>" {
		t.Fatalf("missing-keys stamp: %+v", s2)
	}
}

func TestFindLiveExtensionInfoPlist(t *testing.T) {
	orig := systemExtensionsRoot
	t.Cleanup(func() { systemExtensionsRoot = orig })

	// Non-existent root → ReadDir error → "".
	systemExtensionsRoot = filepath.Join(t.TempDir(), "absent")
	if got := findLiveExtensionInfoPlist(); got != "" {
		t.Fatalf("absent root = %q, want empty", got)
	}

	// Two UUID dirs, both holding our extension; newest-mtime wins.
	root := t.TempDir()
	systemExtensionsRoot = root
	target := "com.nexus-gateway.agent.extension.systemextension/Contents"
	mk := func(uuid string, mtime time.Time) string {
		d := filepath.Join(root, uuid, target)
		_ = os.MkdirAll(d, 0o755)
		p := filepath.Join(d, "Info.plist")
		_ = os.WriteFile(p, []byte("x"), 0o644)
		_ = os.Chtimes(p, mtime, mtime)
		return p
	}
	_ = mk("AAAA", time.Now().Add(-time.Hour))
	newest := mk("BBBB", time.Now())
	// A non-dir entry + a dir without our extension are skipped.
	_ = os.WriteFile(filepath.Join(root, "stray.txt"), []byte("x"), 0o644)
	_ = os.MkdirAll(filepath.Join(root, "CCCC", "other"), 0o755)
	if got := findLiveExtensionInfoPlist(); got != newest {
		t.Fatalf("findLive = %q, want newest %q", got, newest)
	}
}

func TestInspectBundles(t *testing.T) {
	// On the test host the hardcoded /Applications paths don't exist, so each
	// stamp carries a note rather than panicking — InspectBundles must always
	// return a complete (partial-data) inventory.
	bv := InspectBundles()
	if bv.HostApp.Path == "" || bv.ExtensionDisk.Path == "" {
		t.Fatalf("InspectBundles must populate stamp paths: %+v", bv)
	}
}
