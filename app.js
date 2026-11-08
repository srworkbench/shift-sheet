"use strict";
const api = globalThis.ShiftSheet;
const element = id => document.getElementById(id);
let table = null;
let rows = null;
let revision = 0;
let pendingImports = 0;
const example = [
  "Employee,Date,In,Out,In2,Out2",
  "Operator 01,2026-11-02,09:00,17:00,,",
  "Operator 02,2026-11-02,08:00,12:00,12:30,16:00",
  "Operator 03,2026-11-02,09:00,,,",
  "Operator 01,2026-11-02,09:00,17:00,,",
  "Operator 04,2026-11-02,10:00,14:15,,"
].join("\n");

function message(text, error = false) {
  element("message").textContent = text;
  element("message").classList.toggle("error", error);
}
function invalidate() {
  revision++;
  table = null;
  rows = null;
  element("mapping-panel").hidden = true;
  element("results").hidden = true;
  element("download-checked").disabled = true;
}
function readColumns() {
  if (pendingImports) return;
  invalidate();
  try {
    table = api.parseCSV(element("source").value);
    const suggested = api.suggestMapping(table.headers);
    element("mapping").replaceChildren();
    for (const field of api.fields) {
      const wrapper = document.createElement("div");
      const label = document.createElement("label");
      const select = document.createElement("select");
      select.id = "map-" + field;
      label.htmlFor = select.id;
      label.textContent = api.fieldNames[field] + (field.endsWith("2") ? " (optional)" : "");
      select.add(new Option("Choose a column", "-1"));
      for (const [index, header] of table.headers.entries()) select.add(new Option(header, String(index)));
      select.value = String(suggested[field]);
      select.addEventListener("change", () => {
        rows = null;
        element("results").hidden = true;
      });
      wrapper.append(label, select);
      element("mapping").append(wrapper);
    }
    element("mapping-panel").hidden = false;
    message("Read " + table.records.length + " data rows. Check the column choices and date format.");
  } catch (error) { message(error.message, true); }
}
function refreshResults() {
  if (!rows) return;
  const results = api.evaluate(rows, element("date-format").value);
  const ready = results.filter(result => result.status === "Ready");
  const held = results.filter(result => result.status === "Held");
  const excluded = results.filter(result => result.status === "Excluded");
  const minutes = ready.reduce((sum, result) => sum + result.minutes, 0);
  element("summary").replaceChildren();
  for (const [number, label, className] of [
    [ready.length, "Ready rows", ""], [held.length, "Held rows", "held"],
    [excluded.length, "Excluded rows", ""], [(minutes / 60).toFixed(2), "Ready hours", ""]
  ]) {
    const block = document.createElement("div");
    block.className = className;
    const value = document.createElement("strong"), caption = document.createElement("span");
    value.textContent = number;
    caption.textContent = label;
    block.append(value, caption);
    element("summary").append(block);
  }
  results.forEach((result, index) => {
    const tr = element("rows").children[index];
    tr.className = result.status.toLowerCase();
    tr.querySelector(".hours").textContent = result.minutes === null ? "—" : (result.minutes / 60).toFixed(2);
    const status = tr.querySelector(".status");
    const title = document.createElement("strong");
    title.textContent = result.status;
    status.replaceChildren(title, document.createTextNode(result.issues.join(" ")));
  });
  element("download-checked").disabled = held.length > 0 || ready.length === 0;
}
function review() {
  if (!table) return;
  try {
    const mapping = Object.fromEntries(api.fields.map(field => [field, Number(element("map-" + field).value)]));
    rows = api.makeRows(table, mapping);
    element("rows").replaceChildren();
    for (const row of rows) {
      const tr = document.createElement("tr");
      const source = tr.insertCell();
      source.textContent = row.sourceRow;
      for (const field of api.fields) {
        const cell = tr.insertCell();
        const input = document.createElement("input");
        input.type = "text";
        input.value = row.values[field];
        input.className = field;
        input.setAttribute("aria-label", "Row " + row.sourceRow + " " + api.fieldNames[field]);
        input.addEventListener("input", () => { row.values[field] = input.value; refreshResults(); });
        cell.append(input);
      }
      tr.insertCell().className = "hours";
      tr.insertCell().className = "status";
      const exclusion = document.createElement("input");
      exclusion.type = "checkbox";
      exclusion.setAttribute("aria-label", "Exclude row " + row.sourceRow);
      exclusion.addEventListener("change", () => { row.excluded = exclusion.checked; refreshResults(); });
      tr.insertCell().append(exclusion);
      const note = document.createElement("input");
      note.type = "text";
      note.className = "note";
      note.setAttribute("aria-label", "Row " + row.sourceRow + " review note");
      note.addEventListener("input", () => { row.note = note.value; refreshResults(); });
      tr.insertCell().append(note);
      element("rows").append(tr);
    }
    element("results").hidden = false;
    refreshResults();
    message("Review created. Resolve held rows, then download checked hours and the review log.");
    element("results").scrollIntoView({behavior: "smooth", block: "start"});
  } catch (error) { rows = null; element("results").hidden = true; message(error.message, true); }
}
function download(kind) {
  try {
    if (!rows) throw new Error("Review the current source first.");
    const csv = api.exportCSV(rows, element("date-format").value, kind);
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = "shift-sheet-" + kind + ".csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    message("Downloaded " + (kind === "checked" ? "checked hours" : "the review log") + ".");
  } catch (error) { message(error.message, true); }
}
element("source").addEventListener("input", () => { invalidate(); message("Source changed. Read the columns again."); });
element("date-format").addEventListener("change", () => { rows = null; element("results").hidden = true; message("Date format changed. Review the timecards again."); });
element("example").addEventListener("click", () => { invalidate(); element("source").value = example; element("date-format").value = "ymd"; readColumns(); });
element("read").addEventListener("click", readColumns);
element("review").addEventListener("click", review);
element("download-checked").addEventListener("click", () => download("checked"));
element("download-review").addEventListener("click", () => download("review"));
element("csv-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  invalidate();
  const current = revision;
  pendingImports++;
  element("read").disabled = true;
  let loaded = false;
  try {
    if (file.size > 8000000) throw new Error("Choose a smaller UTF-8 CSV.");
    const text = new TextDecoder("utf-8", {fatal: true}).decode(await file.arrayBuffer());
    if (current !== revision) throw new Error("The source changed while the file was being read. Choose the file again.");
    element("source").value = text;
    loaded = true;
  } catch (error) { message(error instanceof TypeError ? "Export the file as UTF-8 CSV and try again." : error.message, true); }
  finally {
    pendingImports--;
    if (loaded && !pendingImports && current === revision) readColumns();
    element("read").disabled = pendingImports > 0;
    event.target.value = "";
  }
});
