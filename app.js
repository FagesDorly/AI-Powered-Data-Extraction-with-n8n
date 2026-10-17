// ====== Configuration ======
// Le webhook n8n n'est jamais exposé au navigateur : il vit dans la variable
// d'environnement N8N_WEBHOOK_URL, lue par la fonction /api/extract (côté serveur).
const API_URL = "/api/extract";
const MAX_MB = 4; // limite Vercel : 4,5 Mo max par requête serverless

// ====== État ======
let items = [], uid = 0, view = "table", onlyIncomplete = false;
const $ = id => document.getElementById(id);
const isEmpty = v => v === undefined || v === null || ["", "null", "n/a", "undefined", "none"].includes(String(v).trim().toLowerCase());

// ====== Import des fichiers ======
const drop = $("drop"), input = $("file");
drop.addEventListener("click", () => input.click());
drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
["dragenter","dragover"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over"); }));
["dragleave","drop"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", ev => addFiles(ev.dataTransfer.files));
input.addEventListener("change", ev => { addFiles(ev.target.files); ev.target.value = ""; });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => e.preventDefault());

function addFiles(list){
  showErr("");
  const rejected = [];
  for (const f of list){
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) { rejected.push(`${f.name} is not a pdf file`); continue; }
    if (f.size > MAX_MB*1024*1024) { rejected.push(`${f.name} is more than ${MAX_MB} Mo`); continue; }
    items.push({ id:++uid, file:f, status:"pending", labels:[], values:{} });
  }
  if (rejected.length) showErr(rejected.join(" · "));
  renderAll();
}
$("clear").onclick = () => { items = []; showErr(""); renderAll(); };

// ====== Dynamic Columns (Union of Detected Fields) ======
function columns(){
  const seen = new Set(), cols = [];
  items.filter(i => i.status === "ok").forEach(i => i.labels.forEach(l => { if (!seen.has(l)) { seen.add(l); cols.push(l); } }));
  return cols;
}
const missingOf = (it, cols) => cols.filter(c => isEmpty(it.values[c])).length;

// ====== n8n Call ======
$("go").onclick = async () => {
  showErr("");
  const btn = $("go");
  for (const it of items){
    if (it.status === "ok") continue;
    it.status = "loading"; renderAll();
    btn.innerHTML = '<span class="spin"></span>Extraction in progress';
    try { Object.assign(it, await extract(it.file), { status:"ok" }); }
    catch (e) { it.status = "err"; showErr(`${it.file.name} : ${e.message}`); }
    renderAll();
  }
  btn.textContent = "Extract the data";
};

async function extract(file){
  const fd = new FormData();
  fd.append("file", file, file.name);
  let res;
  try { res = await fetch(API_URL, { method:"POST", body:fd }); }
  catch { throw new Error("Impossible de joindre le serveur."); }
  if (!res.ok) {
    let detail = ""; try { detail = (await res.json()).error || ""; } catch {}
    throw new Error(detail || `erreur ${res.status}. Vérifiez que le workflow n8n est actif.`);
  }
  let json;
  try { json = await res.json(); } catch { throw new Error("Invalid workflow response."); }
  return normalize(json);
}

function normalize(json){
  if (Array.isArray(json)) json = json[0];
  if (json && json.output) json = json.output;
  if (!json || typeof json !== "object") throw new Error("empty response from the workflow.");
  const pairs = Array.isArray(json.fields)
    ? json.fields.filter(f => f && f.label).map(f => [String(f.label).trim(), f.value])
    : Object.entries(json).filter(([k]) => k !== "document_type");
  const labels = [], values = {}, seen = {};
  for (let [l, v] of pairs){
    if (!l) continue;
    if (v && typeof v === "object") v = JSON.stringify(v);
    let name = l;
    if (seen[l]) { seen[l]++; name = `${l} (${seen[l]})`; } else seen[l] = 1;
    labels.push(name);
    values[name] = isEmpty(v) ? "" : String(v).trim();
  }
  if (!labels.length) throw new Error("aucun champ détecté dans ce PDF.");
  return { labels, values, docType: json.document_type || "" };
}

// ====== Rendu : liste de fichiers ======
const fmtSize = b => b < 1048576 ? Math.max(1, Math.round(b/1024)) + " Ko" : (b/1048576).toFixed(1) + " Mo";

function renderFiles(){
  const ul = $("files"); ul.innerHTML = "";
  if (!items.length){ ul.innerHTML = '<li class="empty-files">No files at this time</li>'; return; }
  const cols = columns();
  items.forEach(it => {
    const li = document.createElement("li"); li.className = "file";
    let badge = '<span class="badge">Pending</span>';
    if (it.status === "loading") badge = '<span class="badge loading"><i class="dot"></i>Analyse…</span>';
    if (it.status === "err") badge = '<span class="badge err">Échec</span>';
    if (it.status === "ok"){
      const m = missingOf(it, cols);
      badge = m ? `<span class="badge warn">${m} vide${m>1?"s":""}</span>` : '<span class="badge ok">Complet</span>';
    }
    li.innerHTML = `<div class="pdf">PDF</div><div class="meta"><div class="name"></div><div class="size"></div></div>${badge}<button class="rm" aria-label="Retirer">×</button>`;
    li.querySelector(".name").textContent = it.file.name;
    li.querySelector(".size").textContent = it.docType ? `${fmtSize(it.file.size)} · ${it.docType}` : fmtSize(it.file.size);
    const rm = li.querySelector(".rm"); rm.disabled = it.status === "loading";
    rm.onclick = () => { items = items.filter(x => x.id !== it.id); renderAll(); };
    ul.appendChild(li);
  });
}

// ====== Rendu : stats ======
function renderStats(){
  const ok = items.filter(i => i.status === "ok"), cols = columns();
  const total = ok.length * cols.length;
  const miss = ok.reduce((n,i) => n + missingOf(i, cols), 0);
  $("stats").innerHTML = `
    <div class="stat"><b>${ok.length}</b><span>fichier${ok.length>1?"s":""} analysed${ok.length>1?"s":""}</span></div>
    <div class="stat"><b>${cols.length}</b><span>champ${cols.length>1?"s":""} detected${cols.length>1?"s":""}</span></div>
    <div class="stat good"><b>${total - miss}</b><span>valeur${total-miss>1?"s":""} informed${total-miss>1?"s":""}</span></div>
    <div class="stat ${miss ? "bad" : "good"}"><b>${miss}</b><span>champ${miss>1?"s":""} empty${miss>1?"s":""}</span></div>`;
  renderFiles();
}

// ====== Rendu : résultats ======
function renderResult(){
  const ok = items.filter(i => i.status === "ok");
  $("result").hidden = !ok.length;
  if (!ok.length) return;
  renderStats();
  const cols = columns();
  const shown = ok.filter(i => !onlyIncomplete || missingOf(i, cols) > 0);
  const host = $("view"); host.innerHTML = "";
  if (!shown.length){ host.innerHTML = '<div class="empty-files">Tous les fichiers sont complets 🎉</div>'; return; }
  view === "table" ? buildTable(host, shown, cols) : buildCards(host, shown, cols);
}

function buildTable(host, shown, cols){
  const wrap = document.createElement("div"); wrap.className = "tablewrap";
  const t = document.createElement("table");
  const hr = t.createTHead().insertRow();
  ["Fichier", ...cols].forEach(c => { const th = document.createElement("th"); th.textContent = c; th.title = c; hr.appendChild(th); });
  const tb = t.createTBody();
  shown.forEach(it => {
    const tr = tb.insertRow();
    const f = tr.insertCell(); f.textContent = it.file.name; f.title = it.file.name;
    cols.forEach(c => {
      const td = tr.insertCell();
      td.contentEditable = "true"; td.spellcheck = false;
      td.dataset.id = it.id; td.dataset.col = c;
      td.textContent = it.values[c] || "";
      if (isEmpty(it.values[c])) td.className = "empty";
    });
  });
  t.addEventListener("input", e => {
    const td = e.target.closest("td[data-col]"); if (!td) return;
    const it = items.find(x => x.id == td.dataset.id);
    it.values[td.dataset.col] = td.textContent.trim();
    td.classList.toggle("empty", isEmpty(td.textContent));
    renderStats();
  });
  t.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });
  t.addEventListener("paste", e => { e.preventDefault(); document.execCommand("insertText", false, (e.clipboardData.getData("text") || "").replace(/\s+/g, " ")); });
  wrap.appendChild(t); host.appendChild(wrap);
}

function buildCards(host, shown, cols){
  const box = document.createElement("div"); box.className = "cards";
  shown.forEach(it => {
    const m = missingOf(it, cols);
    const card = document.createElement("div"); card.className = "fiche";
    card.innerHTML = `<div class="fiche-h"><b></b><span class="badge ${m ? "warn" : "ok"}">${m ? m + " vide" + (m>1?"s":"") : "Complet"}</span></div><div class="grid"></div>`;
    card.querySelector("b").textContent = it.file.name;
    const grid = card.querySelector(".grid");
    cols.forEach(c => {
      const d = document.createElement("div"); d.className = "fld" + (isEmpty(it.values[c]) ? " empty" : "");
      const lab = document.createElement("label"); lab.textContent = c;
      const inp = document.createElement("input"); inp.value = it.values[c] || ""; inp.placeholder = "Vide";
      inp.addEventListener("input", () => {
        it.values[c] = inp.value.trim();
        d.classList.toggle("empty", isEmpty(inp.value));
        const mm = missingOf(it, cols), b = card.querySelector(".fiche-h .badge");
        b.className = "badge " + (mm ? "warn" : "ok"); b.textContent = mm ? mm + " vide" + (mm>1?"s":"") : "Complet";
        renderStats();
      });
      d.append(lab, inp); grid.appendChild(d);
    });
    box.appendChild(card);
  });
  host.appendChild(box);
}

$("seg").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  view = b.dataset.v;
  [...$("seg").children].forEach(x => x.classList.toggle("on", x === b));
  renderResult();
});
$("only").addEventListener("change", e => { onlyIncomplete = e.target.checked; renderResult(); });

function renderAll(){
  const busy = items.some(i => i.status === "loading");
  renderFiles();
  $("go").disabled = busy || !items.some(i => i.status === "pending" || i.status === "err");
  $("clear").hidden = !items.length;
  renderResult();
}

// ====== Export Excel ======
$("dl").onclick = async () => {
  const ok = items.filter(i => i.status === "ok"), cols = columns();
  if (!ok.length) return;
  const heads = ["Fichier", ...cols];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Extraction");
  ws.columns = heads.map(h => ({ header:h, key:h, width:h.length + 4 }));
  const hr = ws.getRow(1); hr.height = 24;
  hr.eachCell(c => {
    c.font = { bold:true, color:{ argb:"FFFFFFFF" } };
    c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0E8A5F" } };
    c.alignment = { vertical:"middle" };
  });
  ok.forEach(it => {
    const row = ws.addRow([it.file.name, ...cols.map(c => it.values[c] || "")]);
    row.eachCell({ includeEmpty:true }, (cell, n) => {
      cell.alignment = { vertical:"middle" };
      cell.border = { bottom:{ style:"thin", color:{ argb:"FFE4E2D9" } } };
      if (n > 1 && isEmpty(it.values[heads[n-1]])) cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFFF4D4D" } };
    });
  });
  ws.columns.forEach(col => {
    let w = String(col.header).length + 4;
    col.eachCell({ includeEmpty:false }, c => { w = Math.max(w, String(c.value ?? "").length + 3); });
    col.width = Math.min(w, 60);
  });
  ws.views = [{ state:"frozen", xSplit:1, ySplit:1 }];
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([buf], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = `extraction-${new Date().toISOString().slice(0,10)}.xlsx`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

function showErr(m){ const e = $("err"); e.hidden = !m; e.textContent = m; }
renderAll();
