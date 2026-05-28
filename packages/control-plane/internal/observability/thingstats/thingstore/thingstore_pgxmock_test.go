package thingstore

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

var tNow = time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)

func sp(s string) *string { return &s }

func anyArgs(n int) []any {
	a := make([]any, n)
	for i := range a {
		a[i] = pgxmock.AnyArg()
	}
	return a
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

var thingCols = []string{
	"id", "type", "name", "version", "address", "enrolled_by", "auth_type", "conn_protocol",
	"status", "enrolled_at", "last_seen_at", "updated_at",
	"desired", "reported", "desired_ver", "reported_ver", "metadata",
}

func thingRow(id, typ string) []any {
	return []any{
		id, typ, sp("name"), sp("1.0"), sp("1.2.3.4:80"), sp("admin"), "mtls", "ws",
		"online", tNow, &tNow, tNow,
		[]byte(`{}`), []byte(`{}`), int64(3), int64(3), []byte(`{}`),
	}
}

// ---- thing_desired ----

func TestQueryThingDesired(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`COALESCE\(desired -> \$2.*FROM thing`).WithArgs("agent", "kill_switch").
		WillReturnRows(pgxmock.NewRows([]string{"id", "type", "d"}).AddRow("t1", "agent", []byte(`{"v":1}`)))
	out, err := s.QueryThingDesired(context.Background(), "agent", "kill_switch")
	if err != nil || len(out) != 1 || out[0].ThingID != "t1" {
		t.Fatalf("QueryThingDesired: %+v %v", out, err)
	}
	m.ExpectQuery(`FROM thing`).WillReturnError(errors.New("boom"))
	if _, err := s.QueryThingDesired(context.Background(), "agent", "k"); err == nil {
		t.Fatal("query error must surface")
	}
	s2, m2 := newMock(t)
	m2.ExpectQuery(`FROM thing`).WithArgs("agent", "k").WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow("t1")) // 1 col vs 3 dests
	if _, err := s2.QueryThingDesired(context.Background(), "agent", "k"); err == nil {
		t.Fatal("scan error must surface")
	}
}

// ---- config_change_event ----

var cceCols = []string{"id", "timestamp", "thing_type", "config_key", "action", "actor_id", "actor_name", "new_state", "new_version", "source_ip", "emergency_override"}

func cceRow() []any {
	return []any{"c1", tNow, "agent", "kill_switch", "update", "u1", "Alice", []byte(`{}`), int64(5), sp("1.2.3.4"), false}
}

func TestInsertConfigChangeEvent(t *testing.T) {
	s, m := newMock(t)
	m.ExpectExec(`INSERT INTO config_change_event`).WithArgs(anyArgs(9)...).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	if err := s.InsertConfigChangeEvent(context.Background(), ConfigChangeEvent{ThingType: "agent", ConfigKey: "k"}); err != nil {
		t.Fatalf("InsertConfigChangeEvent: %v", err)
	}
	m.ExpectExec(`INSERT INTO config_change_event`).WithArgs(anyArgs(9)...).WillReturnError(errors.New("boom"))
	if err := s.InsertConfigChangeEvent(context.Background(), ConfigChangeEvent{}); err == nil {
		t.Fatal("exec error must surface")
	}
}

func TestListConfigChangeEvents(t *testing.T) {
	// All filters set + default limit applied (Limit=0 → 20).
	s, m := newMock(t)
	since := tNow.Add(-time.Hour)
	until := tNow
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM config_change_event`).WithArgs("agent", "kill_switch", "u1", since, until).
		WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m.ExpectQuery(`FROM config_change_event`).WithArgs("agent", "kill_switch", "u1", since, until, 20, 0).
		WillReturnRows(pgxmock.NewRows(cceCols).AddRow(cceRow()...))
	ev, total, err := s.ListConfigChangeEvents(context.Background(), ListConfigChangeEventsParams{
		ThingType: "agent", ConfigKey: "kill_switch", ActorID: "u1", Since: &since, Until: &until,
	})
	if err != nil || total != 1 || len(ev) != 1 || ev[0].ID != "c1" {
		t.Fatalf("ListConfigChangeEvents: %+v total=%d err=%v", ev, total, err)
	}

	// No filters, explicit limit.
	s2, m2 := newMock(t)
	m2.ExpectQuery(`SELECT COUNT`).WithArgs().WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(0))
	m2.ExpectQuery(`FROM config_change_event`).WithArgs(5, 10).WillReturnRows(pgxmock.NewRows(cceCols))
	if _, total, err := s2.ListConfigChangeEvents(context.Background(), ListConfigChangeEventsParams{Limit: 5, Offset: 10}); err != nil || total != 0 {
		t.Fatalf("unfiltered: total=%d err=%v", total, err)
	}

	// Count error.
	s3, m3 := newMock(t)
	m3.ExpectQuery(`SELECT COUNT`).WillReturnError(errors.New("boom"))
	if _, _, err := s3.ListConfigChangeEvents(context.Background(), ListConfigChangeEventsParams{}); err == nil {
		t.Fatal("count error must surface")
	}

	// Data query error.
	s4, m4 := newMock(t)
	m4.ExpectQuery(`SELECT COUNT`).WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m4.ExpectQuery(`FROM config_change_event`).WillReturnError(errors.New("boom"))
	if _, _, err := s4.ListConfigChangeEvents(context.Background(), ListConfigChangeEventsParams{}); err == nil {
		t.Fatal("data error must surface")
	}

	// Scan error.
	s5, m5 := newMock(t)
	m5.ExpectQuery(`SELECT COUNT`).WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m5.ExpectQuery(`FROM config_change_event`).WithArgs(20, 0).WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow("c1"))
	if _, _, err := s5.ListConfigChangeEvents(context.Background(), ListConfigChangeEventsParams{}); err == nil {
		t.Fatal("scan error must surface")
	}

	// Mid-stream iterate error.
	s6, m6 := newMock(t)
	m6.ExpectQuery(`SELECT COUNT`).WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m6.ExpectQuery(`FROM config_change_event`).WithArgs(20, 0).WillReturnRows(pgxmock.NewRows(cceCols).AddRow(cceRow()...).CloseError(errors.New("conn reset")))
	if _, _, err := s6.ListConfigChangeEvents(context.Background(), ListConfigChangeEventsParams{}); err == nil {
		t.Fatal("iterate error must surface")
	}
}

func TestGetLatestConfigChangeEvent(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM config_change_event\s+WHERE thing_type`).WithArgs("agent", "kill_switch").
		WillReturnRows(pgxmock.NewRows(cceCols).AddRow(cceRow()...))
	got, err := s.GetLatestConfigChangeEvent(context.Background(), "agent", "kill_switch")
	if err != nil || got == nil || got.ID != "c1" {
		t.Fatalf("GetLatestConfigChangeEvent: %+v %v", got, err)
	}
	// Not found → (nil, nil).
	m.ExpectQuery(`FROM config_change_event`).WithArgs("agent", "gone").WillReturnError(pgx.ErrNoRows)
	if got, err := s.GetLatestConfigChangeEvent(context.Background(), "agent", "gone"); err != nil || got != nil {
		t.Fatalf("not-found should be (nil,nil): %+v %v", got, err)
	}
	// Other error.
	m.ExpectQuery(`FROM config_change_event`).WithArgs("agent", "x").WillReturnError(errors.New("boom"))
	if _, err := s.GetLatestConfigChangeEvent(context.Background(), "agent", "x"); err == nil {
		t.Fatal("db error must surface")
	}
}

// ---- thing_config_template ----

var tmplCols = []string{"type", "config_key", "state", "version", "updated_at", "updated_by"}

func TestGetTemplate(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM thing_config_template\s+WHERE type`).WithArgs("agent", "k").
		WillReturnRows(pgxmock.NewRows(tmplCols).AddRow("agent", "k", []byte(`{}`), int64(2), tNow, sp("admin")))
	got, err := s.GetTemplate(context.Background(), "agent", "k")
	if err != nil || got == nil || got.Version != 2 {
		t.Fatalf("GetTemplate: %+v %v", got, err)
	}
	m.ExpectQuery(`FROM thing_config_template`).WithArgs("agent", "gone").WillReturnError(pgx.ErrNoRows)
	if got, err := s.GetTemplate(context.Background(), "agent", "gone"); err != nil || got != nil {
		t.Fatalf("not-found should be (nil,nil): %+v %v", got, err)
	}
	m.ExpectQuery(`FROM thing_config_template`).WithArgs("agent", "x").WillReturnError(errors.New("boom"))
	if _, err := s.GetTemplate(context.Background(), "agent", "x"); err == nil {
		t.Fatal("db error must surface")
	}
}

func TestListTemplatesByType(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM thing_config_template\s+WHERE type = \$1`).WithArgs("agent").
		WillReturnRows(pgxmock.NewRows(tmplCols).AddRow("agent", "k1", []byte(`{}`), int64(1), tNow, nil))
	got, err := s.ListTemplatesByType(context.Background(), "agent")
	if err != nil || len(got) != 1 {
		t.Fatalf("ListTemplatesByType: %+v %v", got, err)
	}
	m.ExpectQuery(`FROM thing_config_template`).WillReturnError(errors.New("boom"))
	if _, err := s.ListTemplatesByType(context.Background(), "agent"); err == nil {
		t.Fatal("query error must surface")
	}
	s2, m2 := newMock(t)
	m2.ExpectQuery(`FROM thing_config_template`).WithArgs("agent").WillReturnRows(pgxmock.NewRows([]string{"type"}).AddRow("agent"))
	if _, err := s2.ListTemplatesByType(context.Background(), "agent"); err == nil {
		t.Fatal("scan error must surface")
	}
	s3, m3 := newMock(t)
	m3.ExpectQuery(`FROM thing_config_template`).WithArgs("agent").
		WillReturnRows(pgxmock.NewRows(tmplCols).AddRow("agent", "k", []byte(`{}`), int64(1), tNow, nil).CloseError(errors.New("conn reset")))
	if _, err := s3.ListTemplatesByType(context.Background(), "agent"); err == nil {
		t.Fatal("iterate error must surface")
	}
}

// ---- thing_metrics_rollup ----

var thingRollupCols = []string{"id", "bucketStart", "thing_id", "metricName", "dimensionKey", "subDimension", "value", "metadata", "updatedAt"}

func thingRollupRow(id string, meta any) []any {
	return []any{id, tNow, "t1", "req.count", "provider=openai", "model=x", 1.5, meta, tNow}
}

func TestQueryThingRollup(t *testing.T) {
	s, m := newMock(t)
	start, end := tNow, tNow.Add(time.Hour) // 5m gran
	// Filters: metric + dimension prefix + sub-dimension.
	m.ExpectQuery(`FROM "thing_metric_rollup_5m".*thing_id.*metricName" IN.*dimensionKey" LIKE.*subDimension"`).
		WithArgs("t1", start, end, "req.count", "provider=%", "model=x").
		WillReturnRows(pgxmock.NewRows(thingRollupCols).AddRow(thingRollupRow("r1", []byte(`{}`))...).AddRow(thingRollupRow("r2", nil)...))
	q := ThingMetricsQuery{ThingID: "t1", StartTime: start, EndTime: end, Metrics: []string{"req.count"}, DimensionKey: "provider", SubDimension: "model=x"}
	if got, err := s.QueryThingRollup(context.Background(), q); err != nil || len(got) != 2 || got[0].Metadata == nil || got[1].Metadata != nil {
		t.Fatalf("QueryThingRollup: %+v %v", got, err)
	}

	// Missing ThingID → guard error.
	if _, err := s.QueryThingRollup(context.Background(), ThingMetricsQuery{StartTime: start, EndTime: end}); !errors.Is(err, ErrThingMetricsQueryNoThingID) {
		t.Fatalf("missing ThingID: %v", err)
	}
	// Empty window → nil.
	if got, err := s.QueryThingRollup(context.Background(), ThingMetricsQuery{ThingID: "t1", StartTime: start, EndTime: start}); err != nil || got != nil {
		t.Fatalf("empty window: %+v %v", got, err)
	}
	// Global (no dimension) query error.
	s2, m2 := newMock(t)
	m2.ExpectQuery(`FROM "thing_metric_rollup_5m"`).WillReturnError(errors.New("boom"))
	if _, err := s2.QueryThingRollup(context.Background(), ThingMetricsQuery{ThingID: "t1", StartTime: start, EndTime: end}); err == nil {
		t.Fatal("query error must surface")
	}
	// Scan error.
	s3, m3 := newMock(t)
	m3.ExpectQuery(`FROM "thing_metric_rollup_5m"`).WithArgs("t1", start, end).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow("r1"))
	if _, err := s3.QueryThingRollup(context.Background(), ThingMetricsQuery{ThingID: "t1", StartTime: start, EndTime: end}); err == nil {
		t.Fatal("scan error must surface")
	}
	// Iterate error.
	s4, m4 := newMock(t)
	m4.ExpectQuery(`FROM "thing_metric_rollup_5m"`).WithArgs("t1", start, end).
		WillReturnRows(pgxmock.NewRows(thingRollupCols).AddRow(thingRollupRow("r1", nil)...).CloseError(errors.New("conn reset")))
	if _, err := s4.QueryThingRollup(context.Background(), ThingMetricsQuery{ThingID: "t1", StartTime: start, EndTime: end}); err == nil {
		t.Fatal("iterate error must surface")
	}
}

func TestThingRollupHasAnyRecent(t *testing.T) {
	s, m := newMock(t)
	if _, err := s.ThingRollupHasAnyRecent(context.Background(), "", tNow, tNow.Add(time.Hour)); !errors.Is(err, ErrThingMetricsQueryNoThingID) {
		t.Fatalf("missing ThingID: %v", err)
	}
	m.ExpectQuery(`SELECT EXISTS.*thing_metric_rollup_5m`).WithArgs("t1", tNow, tNow.Add(time.Hour)).
		WillReturnRows(pgxmock.NewRows([]string{"e"}).AddRow(true))
	if ok, err := s.ThingRollupHasAnyRecent(context.Background(), "t1", tNow, tNow.Add(time.Hour)); err != nil || !ok {
		t.Fatalf("ThingRollupHasAnyRecent true: %v %v", ok, err)
	}
	m.ExpectQuery(`SELECT EXISTS`).WillReturnError(errors.New("boom"))
	if _, err := s.ThingRollupHasAnyRecent(context.Background(), "t1", tNow, tNow.Add(time.Hour)); err == nil {
		t.Fatal("error must surface")
	}
}

// ---- thing_registry ----

func TestUpdateThingStatus(t *testing.T) {
	s, m := newMock(t)
	m.ExpectExec(`UPDATE thing\s+SET status`).WithArgs("t1", "offline").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	if err := s.UpdateThingStatus(context.Background(), "t1", "offline"); err != nil {
		t.Fatalf("UpdateThingStatus: %v", err)
	}
	m.ExpectExec(`UPDATE thing`).WithArgs("t1", "offline").WillReturnError(errors.New("boom"))
	if err := s.UpdateThingStatus(context.Background(), "t1", "offline"); err == nil {
		t.Fatal("exec error must surface")
	}
}

func TestGetThing(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM thing WHERE id = \$1`).WithArgs("t1").WillReturnRows(pgxmock.NewRows(thingCols).AddRow(thingRow("t1", "agent")...))
	got, err := s.GetThing(context.Background(), "t1")
	if err != nil || got == nil || got.ID != "t1" {
		t.Fatalf("GetThing: %+v %v", got, err)
	}
	m.ExpectQuery(`FROM thing WHERE id`).WithArgs("gone").WillReturnError(pgx.ErrNoRows)
	if got, err := s.GetThing(context.Background(), "gone"); err != nil || got != nil {
		t.Fatalf("not-found should be (nil,nil): %+v %v", got, err)
	}
	m.ExpectQuery(`FROM thing WHERE id`).WithArgs("x").WillReturnError(errors.New("boom"))
	if _, err := s.GetThing(context.Background(), "x"); err == nil {
		t.Fatal("db error must surface")
	}
}

func TestListThings(t *testing.T) {
	// Both filters.
	s, m := newMock(t)
	m.ExpectQuery(`FROM thing WHERE 1=1 AND type = \$1 AND status = \$2`).WithArgs("agent", "online").
		WillReturnRows(pgxmock.NewRows(thingCols).AddRow(thingRow("t1", "agent")...))
	if got, err := s.ListThings(context.Background(), "agent", "online"); err != nil || len(got) != 1 {
		t.Fatalf("ListThings filtered: %+v %v", got, err)
	}
	// No filters.
	s2, m2 := newMock(t)
	m2.ExpectQuery(`FROM thing WHERE 1=1`).WithArgs().WillReturnRows(pgxmock.NewRows(thingCols).AddRow(thingRow("t1", "agent")...))
	if got, err := s2.ListThings(context.Background(), "", ""); err != nil || len(got) != 1 {
		t.Fatalf("ListThings unfiltered: %+v %v", got, err)
	}
	// Query error.
	s3, m3 := newMock(t)
	m3.ExpectQuery(`FROM thing`).WillReturnError(errors.New("boom"))
	if _, err := s3.ListThings(context.Background(), "", ""); err == nil {
		t.Fatal("query error must surface")
	}
	// Scan error.
	s4, m4 := newMock(t)
	m4.ExpectQuery(`FROM thing`).WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow("t1"))
	if _, err := s4.ListThings(context.Background(), "", ""); err == nil {
		t.Fatal("scan error must surface")
	}
	// Iterate error.
	s5, m5 := newMock(t)
	m5.ExpectQuery(`FROM thing`).WillReturnRows(pgxmock.NewRows(thingCols).AddRow(thingRow("t1", "agent")...).CloseError(errors.New("conn reset")))
	if _, err := s5.ListThings(context.Background(), "", ""); err == nil {
		t.Fatal("iterate error must surface")
	}
}

func TestListDriftedThings(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`reported_ver < desired_ver`).WillReturnRows(pgxmock.NewRows(thingCols).AddRow(thingRow("t1", "agent")...))
	if got, err := s.ListDriftedThings(context.Background()); err != nil || len(got) != 1 {
		t.Fatalf("ListDriftedThings: %+v %v", got, err)
	}
	m.ExpectQuery(`reported_ver < desired_ver`).WillReturnError(errors.New("boom"))
	if _, err := s.ListDriftedThings(context.Background()); err == nil {
		t.Fatal("query error must surface")
	}
	s2, m2 := newMock(t)
	m2.ExpectQuery(`reported_ver < desired_ver`).WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow("t1"))
	if _, err := s2.ListDriftedThings(context.Background()); err == nil {
		t.Fatal("scan error must surface")
	}
	s3, m3 := newMock(t)
	m3.ExpectQuery(`reported_ver < desired_ver`).WillReturnRows(pgxmock.NewRows(thingCols).AddRow(thingRow("t1", "agent")...).CloseError(errors.New("conn reset")))
	if _, err := s3.ListDriftedThings(context.Background()); err == nil {
		t.Fatal("iterate error must surface")
	}
}

func TestGetThingTypeSummaries(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`GROUP BY type`).WillReturnRows(
		pgxmock.NewRows([]string{"type", "total", "online", "offline", "drift"}).AddRow("agent", 10, 7, 2, 1))
	got, err := s.GetThingTypeSummaries(context.Background())
	if err != nil || len(got) != 1 || got[0].Online != 7 {
		t.Fatalf("GetThingTypeSummaries: %+v %v", got, err)
	}
	m.ExpectQuery(`GROUP BY type`).WillReturnError(errors.New("boom"))
	if _, err := s.GetThingTypeSummaries(context.Background()); err == nil {
		t.Fatal("query error must surface")
	}
	s2, m2 := newMock(t)
	m2.ExpectQuery(`GROUP BY type`).WillReturnRows(pgxmock.NewRows([]string{"type"}).AddRow("agent"))
	if _, err := s2.GetThingTypeSummaries(context.Background()); err == nil {
		t.Fatal("scan error must surface")
	}
	s3, m3 := newMock(t)
	m3.ExpectQuery(`GROUP BY type`).WillReturnRows(
		pgxmock.NewRows([]string{"type", "total", "online", "offline", "drift"}).AddRow("agent", 1, 1, 0, 0).CloseError(errors.New("conn reset")))
	if _, err := s3.GetThingTypeSummaries(context.Background()); err == nil {
		t.Fatal("iterate error must surface")
	}
}
