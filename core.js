(function (root) {
  "use strict";
  const fields = ["employee", "date", "in1", "out1", "in2", "out2"];
  const fieldNames = {employee: "Employee", date: "Date", in1: "In 1", out1: "Out 1", in2: "In 2", out2: "Out 2"};

  function parseCSV(input) {
    if (input.length > 2000000) throw new Error("Choose a CSV smaller than 2 million characters.");
    const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const records = [];
    const sourceRows = [];
    let sourceRecord = 1;
    let row = [], cell = "", quoted = false, closed = false;
    function finishCell() {
      row.push(cell);
      cell = "";
      closed = false;
    }
    function finishRow() {
      finishCell();
      if (row.some(value => value.trim())) {
        records.push(row);
        sourceRows.push(sourceRecord);
      }
      sourceRecord++;
      row = [];
    }
    for (let i = 0; i < text.length; i++) {
      const character = text[i];
      if (quoted) {
        if (character === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else { quoted = false; closed = true; }
        } else cell += character;
      } else if (character === ",") finishCell();
      else if (character === "\n") finishRow();
      else if (character === '"' && !cell && !closed) quoted = true;
      else if (closed || character === '"') throw new Error("A CSV quote is misplaced. Export the sheet as comma-separated UTF-8 CSV.");
      else cell += character;
    }
    if (quoted) throw new Error("A quoted CSV cell is unfinished.");
    if (cell || row.length || closed) finishRow();
    if (records.length < 2) throw new Error("Include a header and at least one data row.");
    if (records.length > 5001) throw new Error("Review up to 5,000 rows at a time.");
    const headers = records.shift().map(value => value.trim());
    sourceRows.shift();
    if (headers.some(value => !value)) throw new Error("Every column needs a header.");
    if (new Set(headers.map(value => value.toLowerCase())).size !== headers.length) throw new Error("Give repeated headers distinct names before importing.");
    for (const [index, values] of records.entries()) {
      if (values.length !== headers.length) throw new Error("Data record " + (index + 1) + " has a different number of columns from the header.");
    }
    return {headers, records, sourceRows};
  }

  function suggestMapping(headers) {
    const aliases = {
      employee: ["employee", "employeename", "employeeid", "name"],
      date: ["date", "workdate", "shiftdate"],
      in1: ["in", "in1", "clockin", "clockin1", "start", "start1"],
      out1: ["out", "out1", "clockout", "clockout1", "end", "end1"],
      in2: ["in2", "clockin2", "start2"],
      out2: ["out2", "clockout2", "end2"]
    };
    const mapping = {};
    for (const field of fields) {
      const matches = headers.map((header, index) => aliases[field].includes(header.toLowerCase().replace(/[^a-z0-9]/g, "")) ? index : -1).filter(index => index >= 0);
      mapping[field] = matches.length === 1 ? matches[0] : -1;
    }
    return mapping;
  }

  function makeRows(table, mapping) {
    for (const field of fields.slice(0, 4)) {
      if (!Number.isInteger(mapping[field]) || mapping[field] < 0 || mapping[field] >= table.headers.length) throw new Error("Choose the " + fieldNames[field] + " column.");
    }
    if ((mapping.in2 >= 0) !== (mapping.out2 >= 0)) throw new Error("Map both second-segment columns, or choose neither.");
    for (const field of fields.slice(4)) {
      if (mapping[field] !== -1 && (!Number.isInteger(mapping[field]) || mapping[field] >= table.headers.length)) throw new Error("Choose a valid " + fieldNames[field] + " column, or choose neither second-segment column.");
    }
    const used = fields.filter(field => mapping[field] >= 0).map(field => mapping[field]);
    if (new Set(used).size !== used.length) throw new Error("Each mapped field needs its own column.");
    return table.records.map((record, index) => {
      const values = {};
      for (const field of fields) values[field] = mapping[field] >= 0 ? record[mapping[field]].trim() : "";
      return {sourceRow: table.sourceRows[index], values, original: {...values}, excluded: false, note: ""};
    });
  }

  function parseDate(value, format) {
    const pattern = format === "ymd" ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const match = value.trim().match(pattern);
    if (!match) return null;
    let year, month, day;
    if (format === "ymd") [year, month, day] = match.slice(1).map(Number);
    else if (format === "mdy") [month, day, year] = match.slice(1).map(Number);
    else if (format === "dmy") [day, month, year] = match.slice(1).map(Number);
    else return null;
    if (year < 1900 || year > 2199) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  function parseTime(value) {
    const text = value.trim();
    if (text === "0") return 0;
    let match = text.match(/^(\d{1,2}):(\d{2})(?::00)?$/);
    if (match) {
      const hour = Number(match[1]), minute = Number(match[2]);
      return hour < 24 && minute < 60 ? hour * 60 + minute : null;
    }
    match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2] || 0);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return (hour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + minute;
  }

  function evaluate(rows, format) {
    const results = rows.map(row => {
      const value = row.values;
      const issues = [];
      const date = parseDate(value.date, format);
      if (row.excluded) return {row, status: row.note.trim() ? "Excluded" : "Held", issues: row.note.trim() ? [] : ["Add an exclusion reason."], date, minutes: null};
      if (!value.employee.trim()) issues.push("Add an employee name or ID.");
      if (!date) issues.push("Correct the date using the selected format.");
      const first = [parseTime(value.in1), parseTime(value.out1)];
      const second = [parseTime(value.in2), parseTime(value.out2)];
      const secondUsed = !!(value.in2.trim() || value.out2.trim()) && !(second[0] === 0 && second[1] === 0);
      if (first.includes(null)) issues.push("Complete In 1 and Out 1 with valid clock times.");
      if (secondUsed && second.includes(null)) issues.push("Complete both times for the second segment.");
      if (!first.includes(null) && first[1] <= first[0]) issues.push("Out 1 must follow In 1 on the same day.");
      if (secondUsed && !second.includes(null) && second[1] <= second[0]) issues.push("Out 2 must follow In 2 on the same day.");
      if (secondUsed && !first.includes(null) && !second.includes(null) && second[0] < first[1]) issues.push("The two segments overlap or are out of order.");
      const minutes = issues.length ? null : first[1] - first[0] + (secondUsed ? second[1] - second[0] : 0);
      return {row, status: issues.length ? "Held" : "Ready", issues, date, minutes};
    });
    const groups = new Map();
    for (const result of results) {
      if (result.row.excluded || !result.date || !result.row.values.employee.trim()) continue;
      const key = JSON.stringify([result.row.values.employee.trim().replace(/\s+/g, " ").toLowerCase(), result.date]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(result);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const result of group) {
        result.issues.push("Multiple rows for this employee and date. Combine the segments in the source, or exclude an unwanted row with a reason.");
        result.status = "Held";
        result.minutes = null;
      }
    }
    return results;
  }

  function changes(row) {
    return fields.filter(field => row.values[field] !== row.original[field]).map(field => fieldNames[field] + ": " + (row.original[field] || "(blank)") + " -> " + (row.values[field] || "(blank)")).join(" | ");
  }
  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function exportCSV(rows, format, kind) {
    const results = evaluate(rows, format);
    if (kind === "checked" && results.some(result => result.status === "Held")) throw new Error("Resolve every held row or record an exclusion reason first.");
    if (!["checked", "review"].includes(kind)) throw new Error("Unknown export.");
    const output = [["Source row", "Status", "Employee", "Date", "In 1", "Out 1", "In 2", "Out 2", "Minutes", "Hours", "Issues", "Review note", "Corrections"]];
    for (const result of results) {
      if (kind === "checked" && result.status !== "Ready") continue;
      const value = result.row.values;
      output.push([result.row.sourceRow, result.status, value.employee, result.date || value.date, value.in1, value.out1, value.in2, value.out2, result.minutes, result.minutes === null ? "" : (result.minutes / 60).toFixed(4), result.issues.join(" "), result.row.note, changes(result.row)]);
    }
    return "\uFEFF" + output.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  const api = {fields, fieldNames, parseCSV, suggestMapping, makeRows, parseDate, parseTime, evaluate, exportCSV, changes};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ShiftSheet = api;
})(globalThis);
