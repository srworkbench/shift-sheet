const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../core.js");
function exampleRows() {
  const table = api.parseCSV(fs.readFileSync(path.join(__dirname, "../example.csv"), "utf8"));
  return api.makeRows(table, api.suggestMapping(table.headers));
}
test("one and two segments total exactly, while missing punches and duplicates are held", () => {
  const result = api.evaluate(exampleRows(), "ymd");
  assert.deepEqual(result.map(row => [row.status, row.minutes]), [["Held", null], ["Ready", 450], ["Held", null], ["Held", null], ["Ready", 255]]);
});
test("normal review journey resolves the missing punch and a confirmed duplicate", () => {
  const rows = exampleRows();
  assert.throws(() => api.exportCSV(rows, "ymd", "checked"), /Resolve every held/);
  rows[2].values.out1 = "17:00";
  rows[3].excluded = true;
  assert.ok(api.evaluate(rows, "ymd").some(row => row.status === "Held"));
  rows[3].note = "Confirmed repeated source line";
  const result = api.evaluate(rows, "ymd");
  assert.equal(result.filter(row => row.status === "Held").length, 0);
  assert.equal(result.reduce((sum, row) => sum + (row.minutes || 0), 0), 1665);
  const checked = api.parseCSV(api.exportCSV(rows, "ymd", "checked"));
  assert.equal(checked.records.length, 4);
  assert.match(api.exportCSV(rows, "ymd", "review"), /Confirmed repeated source line/);
  assert.match(api.exportCSV(rows, "ymd", "review"), /Out 1: \(blank\) -> 17:00/);
});
test("CSV quotes, embedded newlines and blank record source numbers survive import", () => {
  const table = api.parseCSV('Employee,Date,In,Out\n\n"Team, ""A""",2026-11-02,9am,5pm\n"Team\nB",2026-11-03,10:00,14:00\n');
  const rows = api.makeRows(table, api.suggestMapping(table.headers));
  assert.deepEqual(rows.map(row => row.sourceRow), [3, 4]);
  assert.equal(rows[0].values.employee, 'Team, "A"');
  assert.equal(rows[1].values.employee, "Team\nB");
  assert.throws(() => api.parseCSV('a,b\n"open,b'), /unfinished/);
  assert.throws(() => api.parseCSV('a,b\n"x"bad,y'), /quote/);
  assert.throws(() => api.parseCSV("a,b\n1,2,3"), /different number/);
});
test("dates are calendar-valid and date formats are explicit", () => {
  assert.equal(api.parseDate("2026-02-29", "ymd"), null);
  assert.equal(api.parseDate("2028-02-29", "ymd"), "2028-02-29");
  assert.equal(api.parseDate("11/02/2026", "mdy"), "2026-11-02");
  assert.equal(api.parseDate("11/02/2026", "dmy"), "2026-02-11");
  assert.equal(api.parseDate("2026-13-01", "ymd"), null);
});
test("clock times retain minute precision without guessing overnight shifts", () => {
  for (const [text, expected] of [["12am",0],["12pm",720],["9:30 PM",1290],["09:30:00",570],["24:00",null],["09:30:01",null],["9:60",null]]) assert.equal(api.parseTime(text), expected, text);
  const rows = exampleRows().slice(1, 2);
  rows[0].values.out1 = "07:00";
  assert.equal(api.evaluate(rows, "ymd")[0].minutes, null);
  rows[0].values.out1 = "12:30";
  rows[0].values.in2 = "12:00";
  assert.match(api.evaluate(rows, "ymd")[0].issues.join(" "), /overlap/);
});
test("an empty second segment is allowed, a half segment is held, zero is a clock time", () => {
  const rows = exampleRows().slice(4);
  assert.equal(api.evaluate(rows, "ymd")[0].minutes, 255);
  rows[0].values.in2 = "15:00";
  assert.equal(api.evaluate(rows, "ymd")[0].minutes, null);
  rows[0].values.in1 = "00:00"; rows[0].values.out1 = "08:00"; rows[0].values.in2 = "";
  assert.equal(api.evaluate(rows, "ymd")[0].minutes, 480);
});
test("mapping does not silently use one column twice or half of a second pair", () => {
  const table = api.parseCSV(fs.readFileSync(path.join(__dirname, "../example.csv"), "utf8"));
  const mapping = api.suggestMapping(table.headers);
  assert.throws(() => api.makeRows(table, {...mapping, out2: -1}), /both second/);
  assert.throws(() => api.makeRows(table, {...mapping, out1: mapping.in1}), /own column/);
  assert.throws(() => api.makeRows(table, {...mapping, in2: 100, out2: 101}), /valid/);
});
test("legacy zero-filled second segments count as unused, while half-filled segments remain held", () => {
  const rows = exampleRows().slice(4);
  for (const zero of ["0", "00:00", "12 AM"]) {
    rows[0].values.in2 = zero; rows[0].values.out2 = zero;
    assert.equal(api.evaluate(rows, "ymd")[0].minutes, 255);
  }
  rows[0].values.out2 = "";
  assert.equal(api.evaluate(rows, "ymd")[0].minutes, null);
});
test("CSV exports neutralize formula prefixes including leading whitespace", () => {
  const rows = exampleRows().slice(4);
  rows[0].values.employee = " =1+2";
  rows[0].note = "@review";
  const csv = api.exportCSV(rows, "ymd", "checked");
  assert.ok(csv.includes('"\' =1+2"'));
  assert.ok(csv.includes('"\'@review"'));
});
