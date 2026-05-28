//go:build darwin

package proc

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProcessInfo_Self(t *testing.T) {
	// libproc resolves the running test binary's own metadata.
	m, err := ProcessInfo(os.Getpid())
	if err != nil {
		t.Fatalf("ProcessInfo(self): %v", err)
	}
	if m.Path == "" || m.Name == "" {
		t.Fatalf("self meta incomplete: %+v", m)
	}
	if m.User == "" {
		t.Errorf("expected resolved User, got empty: %+v", m)
	}
}

func TestProcessInfo_BadPID(t *testing.T) {
	// A pid that does not exist → proc_pidpath yields no path → error.
	if _, err := ProcessInfo(1<<30 + 7); err == nil {
		t.Fatal("ProcessInfo on a non-existent pid must error")
	}
}

func TestLooksLikeVersionString(t *testing.T) {
	versions := []string{"2.1.141", "1.0", "3.4.5-beta", "10.2"}
	for _, v := range versions {
		if !LooksLikeVersionString(v) {
			t.Errorf("LooksLikeVersionString(%q) = false, want true", v)
		}
	}
	names := []string{"", "Cursor", "Chrome", "v2.3", "-1.0", "abc", "1.0 2", "1@2"}
	for _, n := range names {
		if LooksLikeVersionString(n) {
			t.Errorf("LooksLikeVersionString(%q) = true, want false", n)
		}
	}
}

func writeApp(t *testing.T, appName, plistBody string) string {
	t.Helper()
	root := t.TempDir()
	contents := filepath.Join(root, appName, "Contents")
	if err := os.MkdirAll(filepath.Join(contents, "MacOS"), 0o755); err != nil {
		t.Fatal(err)
	}
	if plistBody != "" {
		if err := os.WriteFile(filepath.Join(contents, "Info.plist"), []byte(plistBody), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return filepath.Join(contents, "MacOS", "2.1.141") // versioned helper exe path
}

func TestDetectBundleID(t *testing.T) {
	plist := `<plist><dict>
		<key>CFBundleIdentifier</key><string>com.example.cursor</string>
		</dict></plist>`
	exe := writeApp(t, "Cursor.app", plist)
	if got := DetectBundleID(exe); got != "com.example.cursor" {
		t.Fatalf("DetectBundleID = %q", got)
	}
	// No .app ancestor → empty.
	if got := DetectBundleID("/usr/bin/true"); got != "" {
		t.Fatalf("non-bundle DetectBundleID = %q, want empty", got)
	}
	// .app present but Info.plist missing → empty.
	exeNoPlist := writeApp(t, "NoPlist.app", "")
	if got := DetectBundleID(exeNoPlist); got != "" {
		t.Fatalf("missing-plist DetectBundleID = %q, want empty", got)
	}
	// Info.plist present but no CFBundleIdentifier key → break → empty.
	exeNoKey := writeApp(t, "NoKey.app", `<plist><dict><key>CFBundleName</key><string>x</string></dict></plist>`)
	if got := DetectBundleID(exeNoKey); got != "" {
		t.Fatalf("no-id-key DetectBundleID = %q, want empty", got)
	}
	// CFBundleIdentifier key present but the <string> value is malformed → empty.
	exeMalformed := writeApp(t, "Malformed.app", `<plist><dict><key>CFBundleIdentifier</key> no value here</dict></plist>`)
	if got := DetectBundleID(exeMalformed); got != "" {
		t.Fatalf("malformed-id DetectBundleID = %q, want empty", got)
	}
}

func TestBundleDisplayNameFromPath(t *testing.T) {
	// DisplayName preferred over Name.
	exe := writeApp(t, "Cursor.app", `<plist><dict>
		<key>CFBundleName</key><string>cursor</string>
		<key>CFBundleDisplayName</key><string>Cursor</string>
		</dict></plist>`)
	if got := BundleDisplayNameFromPath(exe); got != "Cursor" {
		t.Fatalf("BundleDisplayNameFromPath = %q, want Cursor", got)
	}
	// Only CFBundleName → falls back to it.
	exe2 := writeApp(t, "App2.app", `<plist><dict><key>CFBundleName</key><string>App Two</string></dict></plist>`)
	if got := BundleDisplayNameFromPath(exe2); got != "App Two" {
		t.Fatalf("BundleDisplayNameFromPath name-only = %q", got)
	}
	// No .app ancestor → empty.
	if got := BundleDisplayNameFromPath("/usr/bin/true"); got != "" {
		t.Fatalf("non-bundle display name = %q, want empty", got)
	}
	// .app whose Info.plist is missing → readFile err → walk further up → "".
	exeNoPlist := writeApp(t, "NoPlist.app", "")
	if got := BundleDisplayNameFromPath(exeNoPlist); got != "" {
		t.Fatalf("missing-plist display name = %q, want empty", got)
	}
}

func TestScrapePlistKey(t *testing.T) {
	body := `<key>CFBundleName</key>  <string>  Hello  </string>`
	if got := ScrapePlistKey(body, "CFBundleName"); got != "Hello" {
		t.Fatalf("ScrapePlistKey = %q, want Hello", got)
	}
	if got := ScrapePlistKey(body, "Missing"); got != "" {
		t.Fatalf("missing key = %q, want empty", got)
	}
	if got := ScrapePlistKey(`<key>K</key> no string tag`, "K"); got != "" {
		t.Fatalf("malformed value = %q, want empty", got)
	}
}

func TestIntPtrIfNonZero(t *testing.T) {
	if IntPtrIfNonZero(0) != nil {
		t.Fatal("zero must map to nil")
	}
	if p := IntPtrIfNonZero(42); p == nil || *p != 42 {
		t.Fatalf("non-zero must map to &v, got %v", p)
	}
}
