package agentauditstore

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

func anyArgs(n int) []any {
	a := make([]any, n)
	for i := range a {
		a[i] = pgxmock.AnyArg()
	}
	return a
}

var tNow = time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)

var evCols = []string{
	"id", "deviceId", "timestamp", "sourceProcess", "sourceUser", "subjectId",
	"destHost", "destIp", "destPort", "action", "policyRuleId", "bumpStatus",
	"bytesIn", "bytesOut", "duration", "hookDecision", "createdAt", "deviceHostname", "deviceOs",
}

func sp(s string) *string { return &s }
func ip(i int) *int       { return &i }

func evRow(id string) []any {
	return []any{
		id, "dev1", tNow, "curl", sp("alice"), sp("subj1"),
		"api.example.com", "1.2.3.4", 443, "allow", sp("rule1"), sp("bumped"),
		ip(100), ip(200), ip(50), sp("pass"), tNow, sp("host1"), sp("darwin"),
	}
}

func newMock(t *testing.T) (*Store, pgxmock.PgxPoolIface) {
	t.Helper()
	m, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	t.Cleanup(m.Close)
	return New(m), m
}

func TestListAgentTrafficEvents(t *testing.T) {
	s, m := newMock(t)
	start := tNow.Add(-time.Hour)
	end := tNow
	p := AgentTrafficEventListParams{DeviceID: "dev1", Action: "allow", Q: "curl", StartTime: &start, EndTime: &end, Limit: 10}
	// source='agent' is always appended; then deviceId, action, Q, start, end → 5 filter args.
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM traffic_event e`).
		WithArgs("dev1", "allow", "%curl%", start, end).
		WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(2))
	m.ExpectQuery(`FROM traffic_event e\s+LEFT JOIN thing t`).
		WithArgs("dev1", "allow", "%curl%", start, end, 10, 0).
		WillReturnRows(pgxmock.NewRows(evCols).AddRow(evRow("e1")...).AddRow(evRow("e2")...))
	events, total, err := s.ListAgentTrafficEvents(context.Background(), p)
	if err != nil || total != 2 || len(events) != 2 || events[0].DeviceID != "dev1" || events[0].DestPort != 443 {
		t.Fatalf("ListAgentTrafficEvents: %+v total=%d err=%v", events, total, err)
	}
}

func TestListAgentTrafficEvents_Errors(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`SELECT COUNT`).WillReturnError(errors.New("boom"))
	if _, _, err := s.ListAgentTrafficEvents(context.Background(), AgentTrafficEventListParams{}); err == nil {
		t.Fatal("count error should surface")
	}
	s2, m2 := newMock(t)
	m2.ExpectQuery(`SELECT COUNT`).WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m2.ExpectQuery(`FROM traffic_event e`).WithArgs(anyArgs(2)...).WillReturnError(errors.New("q"))
	if _, _, err := s2.ListAgentTrafficEvents(context.Background(), AgentTrafficEventListParams{Limit: 5}); err == nil {
		t.Fatal("data query error should surface")
	}
	s3, m3 := newMock(t)
	bad := evRow("e1")
	bad[8] = "not-an-int" // destPort
	m3.ExpectQuery(`SELECT COUNT`).WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m3.ExpectQuery(`FROM traffic_event e`).WithArgs(anyArgs(2)...).WillReturnRows(pgxmock.NewRows(evCols).AddRow(bad...))
	if _, _, err := s3.ListAgentTrafficEvents(context.Background(), AgentTrafficEventListParams{Limit: 5}); err == nil {
		t.Fatal("scan error should surface")
	}
}
