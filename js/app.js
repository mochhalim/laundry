/* ===== Sistem Laundry v2 =====
   Aplikasi statis: HTML + CSS + JavaScript + JSON.
   Pengaturan toko dan layanan: ubah lewat menu Setelan di aplikasi,
   atau ubah file data/config.json untuk nilai awal. */
'use strict';

/* ---------- Konstanta ---------- */
const K = { orders: 'laundry.orders.v2', cfg: 'laundry.config.v2', old: 'laundry.pesanan.v1', pin: 'laundry.pin.v2', bak: 'laundry.backup.v2', users: 'laundry.users.v2', sess: 'laundry.sess' };
const STATUS = ['Diterima', 'Dicuci', 'Disetrika', 'Siap diambil', 'Selesai'];
const METODE = ['Tunai', 'QRIS', 'Transfer'];
const SATUAN = ['kg', 'pcs', 'm²', 'pasang', 'lembar'];
const HARI_CADANGAN = 7;
const DEFAULT_CONFIG = {
  toko: { nama: 'Laundry Bersih Kita', alamat: 'Jl. Contoh No. 1, Mojokerto', hp: '08123456789', prefix: 'LDR', footer: 'Terima kasih. Simpan nota ini untuk mengambil cucian.', kertas: '58' },
  layanan: [
    { id: 'kiloan', nama: 'Cuci setrika kiloan', satuan: 'kg', harga: 7000, hari: 3 },
    { id: 'cuci-lipat', nama: 'Cuci lipat saja', satuan: 'kg', harga: 5000, hari: 2 },
    { id: 'setrika', nama: 'Setrika saja', satuan: 'kg', harga: 4000, hari: 2 },
    { id: 'express', nama: 'Express 1 hari', satuan: 'kg', harga: 12000, hari: 1 },
    { id: 'bedcover', nama: 'Selimut / bed cover', satuan: 'pcs', harga: 25000, hari: 4 },
    { id: 'jas', nama: 'Jas / jaket', satuan: 'pcs', harga: 20000, hari: 3 }
  ]
};

/* ---------- Utilitas ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clone = o => JSON.parse(JSON.stringify(o));
const pad = (n, l = 2) => String(n).padStart(l, '0');
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const rp = n => (n < 0 ? '-' : '') + 'Rp' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => fmtD(new Date());
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return fmtD(d); };
const tgl = s => isDate(s) ? new Date(s + 'T00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const jml = n => String(Math.round(n * 100) / 100).replace('.', ',');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { alert('Data gagal disimpan. Penyimpanan browser penuh atau diblokir. Unduh cadangan sekarang, lalu kosongkan ruang.'); return false; }
  },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }
};

let toastT;
function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2400);
}
function download(name, text, type) {
  const a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], { type }));
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1500);
}

/* ---------- State ---------- */
let cfg = clone(DEFAULT_CONFIG), defaults = clone(DEFAULT_CONFIG), orders = [];
let editId = null, selesaiManual = false, limit = 50;

function normCfg(c) {
  const d = DEFAULT_CONFIG, t = Object.assign({}, d.toko, c && c.toko);
  Object.keys(t).forEach(k => t[k] = String(t[k] ?? ''));
  t.kertas = t.kertas === '80' ? '80' : '58';
  t.prefix = (t.prefix || 'LDR').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5) || 'LDR';
  let l = Array.isArray(c && c.layanan) ? c.layanan : d.layanan;
  l = l.map(x => ({
    id: String((x && x.id) || 'svc-' + uid()), nama: String((x && x.nama) || '').trim(),
    satuan: String((x && x.satuan) || 'kg'), harga: Math.max(0, Math.round(num(x && x.harga))), hari: Math.max(0, Math.round(num(x && x.hari)))
  })).filter(x => x.nama);
  return { toko: t, layanan: l.length ? l : clone(d.layanan) };
}

/* ---------- Model pesanan ---------- */
const paid = o => o.payments.reduce((a, p) => a + p.jumlah, 0);
const sisa = o => Math.max(0, o.total - paid(o));
const lunas = o => sisa(o) === 0;
const telat = o => o.status < 4 && o.selesai < today();
const itemTotal = i => Math.round(i.harga * i.jumlah);
const svc = id => cfg.layanan.find(l => l.id === id);

// Menerima format v2 maupun v1 (versi lama), mengembalikan null jika tidak valid.
function normOrder(o) {
  if (!o || typeof o !== 'object' || !o.kode) return null;
  let items = o.items;
  if (!Array.isArray(items)) {
    if (typeof o.total !== 'number') return null; // format lama
    items = [{ lid: '', nama: o.layanan || 'Layanan', satuan: o.satuan || '', harga: num(o.harga), jumlah: num(o.jumlah) || 1 }];
  }
  items = items.map(i => ({ lid: String(i.lid || ''), nama: String(i.nama || ''), satuan: String(i.satuan || ''), harga: Math.max(0, num(i.harga)), jumlah: Math.max(0, num(i.jumlah)) }));
  const subtotal = items.reduce((a, i) => a + itemTotal(i), 0);
  const diskon = Math.max(0, num(o.diskon));
  const total = typeof o.total === 'number' && isFinite(o.total) ? Math.max(0, o.total) : Math.max(0, subtotal - diskon);
  const masuk = isDate(o.masuk) ? o.masuk : today();
  const status = Math.min(4, Math.max(0, Math.round(num(o.status))));
  let payments = Array.isArray(o.payments)
    ? o.payments.map(p => ({ id: String(p.id || uid()), tgl: isDate(p.tgl) ? p.tgl : masuk, jumlah: Math.max(0, num(p.jumlah)), metode: String(p.metode || 'Tunai'), oleh: String(p.oleh || '') }))
    : (o.lunas ? [{ id: uid(), tgl: isDate(o.lunasTgl) ? o.lunasTgl : masuk, jumlah: total, metode: 'Tunai' }] : []);
  payments = payments.filter(p => p.jumlah > 0);
  return {
    id: String(o.id || uid()), kode: String(o.kode), nama: String(o.nama || ''), hp: String(o.hp || ''),
    items, subtotal, diskon, total, payments, masuk, selesai: isDate(o.selesai) ? o.selesai : masuk,
    catatan: String(o.catatan || ''), status,
    riwayat: Array.isArray(o.riwayat) ? o.riwayat : [{ s: status, t: masuk }], dibuat: o.dibuat || masuk, oleh: String(o.oleh || '')
  };
}
function loadOrders() {
  let raw = store.get(K.orders, null), migrasi = false;
  if (raw === null) { const old = store.get(K.old, null); if (Array.isArray(old)) { raw = old; migrasi = true; } else raw = []; }
  const list = (Array.isArray(raw) ? raw : []).map(normOrder).filter(Boolean);
  if (migrasi) { orders = list; saveOrders(); } // data lama tidak dihapus
  return list;
}
const saveOrders = () => store.set(K.orders, orders);
const saveCfg = () => store.set(K.cfg, cfg);
const findO = id => orders.find(o => o.id === id);

function nextKode(masuk) {
  const pre = cfg.toko.prefix + '-' + masuk.replace(/-/g, '').slice(2) + '-';
  const n = Math.max(0, ...orders.filter(o => o.kode.startsWith(pre)).map(o => parseInt(o.kode.split('-').pop(), 10) || 0)) + 1;
  return pre + pad(n, 3);
}

/* ---------- Dialog ---------- */
const dlg = $('#dlg');
function openDlg(html) { $('#dlgBody').innerHTML = html; if (!dlg.open) dlg.showModal(); }
function closeDlg() { if (dlg.open) dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) closeDlg(); });

/* ---------- Navigasi ---------- */
function show(t) {
  if (t === 'laporan' && !isOwner()) { toast('Laporan hanya untuk pemilik'); return; }
  $$('.tab').forEach(e => e.classList.toggle('on', e.id === t));
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  ({ beranda: renderBeranda, daftar: renderDaftar, laporan: renderLaporan, setelan: renderSetelan })[t]?.();
  window.scrollTo(0, 0);
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) { if (b.dataset.tab !== 'kasir' && editId) cancelEdit(); show(b.dataset.tab); } });

/* ---------- Beranda ---------- */
function renderBeranda() {
  const t = today(), ym = t.slice(0, 7);
  const aktif = orders.filter(o => o.status < 4).length;
  const siap = orders.filter(o => o.status === 3).length;
  const lewat = orders.filter(telat).length;
  const piutang = orders.reduce((a, o) => a + sisa(o), 0);
  const allPay = orders.flatMap(o => o.payments);
  const hariIni = allPay.filter(p => p.tgl === t).reduce((a, p) => a + p.jumlah, 0);
  const bulanIni = allPay.filter(p => p.tgl.startsWith(ym)).reduce((a, p) => a + p.jumlah, 0);
  $('#stat').innerHTML = [
    ['', 'Cucian aktif', aktif, 'aktif'], ['w4', 'Siap diambil', siap, 's3'], ['w3', 'Terlambat', lewat, 'telat'],
    ['w2', 'Belum dibayar', rp(piutang), 'utang'], ['w4', 'Pemasukan hari ini', rp(hariIni), ''], ['', 'Pemasukan bulan ini', rp(bulanIni), '']
  ].map(([c, k, v, f]) => `<button class="${c}" ${f ? `data-go="${f}"` : 'tabindex="-1"'}><span>${k}</span><strong>${v}</strong></button>`).join('');

  const hari = store.get(K.bak, 0) ? Math.floor((Date.now() - store.get(K.bak, 0)) / 864e5) : null;
  $('#banner').innerHTML = orders.length && (hari === null || hari >= HARI_CADANGAN)
    ? `<div class="banner"><span>${hari === null ? 'Data Anda belum pernah dicadangkan.' : `Sudah ${hari} hari sejak cadangan terakhir.`} Data hanya ada di browser ini.</span><button data-act="cadangan" class="kecil">Unduh cadangan</button></div>` : '';

  const due = orders.filter(o => o.status < 4 && o.selesai <= t).sort((a, b) => a.selesai.localeCompare(b.selesai));
  const siapL = orders.filter(o => o.status === 3 && o.selesai > t);
  const rows = [...due, ...siapL].slice(0, 8);
  $('#perhatian').innerHTML = rows.length ? rows.map(o => `<div class="baris"><div><strong>${esc(o.nama)}</strong> <small>${o.kode}</small><br><small>${telat(o) ? 'Terlambat sejak ' : 'Estimasi '}${tgl(o.selesai)}, ${STATUS[o.status]}${sisa(o) ? ', sisa ' + rp(sisa(o)) : ''}</small></div><button class="kecil" data-open="${esc(o.kode)}">Buka</button></div>`).join('')
    : '<p class="kosong">Tidak ada cucian yang jatuh tempo. Pekerjaan beres.</p>';
  $('#harga').innerHTML = cfg.layanan.map(l => `<div><strong>${esc(l.nama)}</strong><span>${rp(l.harga)} per ${esc(l.satuan)}, selesai ${l.hari} hari</span></div>`).join('');
}
$('#beranda').addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) { $('#filter').value = g.dataset.go; $('#cari').value = ''; show('daftar'); }
  const o = e.target.closest('[data-open]'); if (o) { $('#filter').value = ''; $('#cari').value = o.dataset.open; show('daftar'); }
  if (e.target.closest('[data-act=cadangan]')) ekspor();
});

/* ---------- Kasir (pesanan baru / ubah) ---------- */
function optLayanan(sel, extra) {
  const list = cfg.layanan.slice(); if (extra && !list.find(l => l.id === extra.id)) list.push(extra);
  return list.map(l => `<option value="${esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${esc(l.nama)} (${rp(l.harga)}/${esc(l.satuan)})</option>`).join('');
}
function addRow(it) {
  const l = it ? (svc(it.lid) || { id: it.lid || 'x-' + uid(), nama: it.nama, satuan: it.satuan, harga: it.harga, hari: 0 }) : cfg.layanan[0];
  const d = document.createElement('div'); d.className = 'item';
  d.dataset.harga = it ? it.harga : l.harga; d.dataset.hari = l.hari || 0;
  d.innerHTML = `<select aria-label="Layanan">${optLayanan(l.id, it ? l : null)}</select>
    <input type="number" inputmode="decimal" min="0.1" step="0.1" aria-label="Jumlah" placeholder="Jumlah" value="${it ? it.jumlah : ''}">
    <span class="unit">${esc(l.satuan)}</span><output class="sub">Rp0</output>
    <button type="button" class="ikon bahaya" data-act="rm" aria-label="Hapus baris">Hapus</button>`;
  d.dataset.nama = l.nama; d.dataset.satuan = l.satuan;
  $('#items').appendChild(d);
}
function rows() {
  return $$('#items .item').map(r => {
    const j = num($('input', r).value);
    return { lid: $('select', r).value, nama: r.dataset.nama, satuan: r.dataset.satuan, harga: num(r.dataset.harga), jumlah: j, hari: num(r.dataset.hari), el: r };
  });
}
function hitung() {
  const rs = rows(); let sub = 0, hari = 0;
  rs.forEach(r => { const t = itemTotal(r); sub += r.jumlah > 0 ? t : 0; if (r.jumlah > 0) hari = Math.max(hari, r.hari); $('.sub', r.el).textContent = rp(r.jumlah > 0 ? t : 0); });
  const diskon = Math.min(Math.max(0, num($('#diskon').value)), sub), total = sub - diskon;
  const dp = editId ? 0 : Math.min(Math.max(0, num($('#dp').value)), total);
  if (!selesaiManual && $('#masuk').value) $('#selesai').value = addDays($('#masuk').value, hari);
  const edit = editId && findO(editId), sdh = edit ? paid(edit) : dp;
  $('#ringkas').innerHTML = `<div><span>Subtotal</span><span>${rp(sub)}</span></div>${diskon ? `<div><span>Diskon</span><span>-${rp(diskon)}</span></div>` : ''}
    <div class="tot"><span>Total</span><span>${rp(total)}</span></div>
    <div><span>${edit ? 'Sudah dibayar' : 'Bayar di muka'}</span><span>${rp(sdh)}</span></div><div><span>Sisa bayar</span><span>${rp(Math.max(0, total - sdh))}</span></div>`;
  return { items: rs.filter(r => r.jumlah > 0), sub, diskon, total, dp };
}
$('#items').addEventListener('input', hitung);
$('#items').addEventListener('change', e => {
  if (e.target.tagName !== 'SELECT') return;
  const r = e.target.closest('.item'), l = svc(e.target.value);
  if (l) { r.dataset.harga = l.harga; r.dataset.hari = l.hari; r.dataset.nama = l.nama; r.dataset.satuan = l.satuan; $('.unit', r).textContent = l.satuan; }
  hitung();
});
$('#items').addEventListener('click', e => {
  if (!e.target.closest('[data-act=rm]')) return;
  if ($$('#items .item').length > 1) { e.target.closest('.item').remove(); hitung(); } else toast('Minimal satu layanan');
});
$('#tambahItem').onclick = () => { addRow(); hitung(); $$('#items .item input').pop().focus(); };
['#masuk', '#diskon', '#dp'].forEach(s => $(s).addEventListener('input', hitung));
$('#selesai').addEventListener('input', () => { selesaiManual = true; });
$('#nama').addEventListener('input', e => {
  const p = pelangganList().find(x => x.nama.toLowerCase() === e.target.value.trim().toLowerCase());
  if (p && !$('#hp').value) $('#hp').value = p.hp;
});
function pelangganList() {
  const m = new Map();
  orders.forEach(o => { const k = o.nama.toLowerCase(); if (o.nama && !m.has(k)) m.set(k, { nama: o.nama, hp: o.hp }); });
  return [...m.values()];
}
function resetForm() {
  editId = null; selesaiManual = false;
  $('#formBaru').reset(); $('#items').innerHTML = ''; addRow();
  $('#masuk').value = today(); $('#dpWrap').hidden = false; $('#batalEdit').hidden = true;
  $('#judulKasir').textContent = 'Catat pesanan baru'; $('#simpan').textContent = 'Simpan pesanan';
  $('#metode').innerHTML = METODE.map(m => `<option>${m}</option>`).join('');
  $('#dlPelanggan').innerHTML = pelangganList().map(p => `<option value="${esc(p.nama)}">`).join('');
  hitung();
}
function startEdit(o) {
  resetForm(); editId = o.id; selesaiManual = true;
  $('#items').innerHTML = ''; o.items.forEach(addRow);
  $('#nama').value = o.nama; $('#hp').value = o.hp; $('#masuk').value = o.masuk; $('#selesai').value = o.selesai;
  $('#catatan').value = o.catatan; $('#diskon').value = o.diskon || '';
  $('#dpWrap').hidden = true; $('#batalEdit').hidden = false;
  $('#judulKasir').textContent = 'Ubah pesanan ' + o.kode; $('#simpan').textContent = 'Simpan perubahan';
  hitung(); show('kasir');
}
function cancelEdit() { resetForm(); }
$('#batalEdit').onclick = () => { cancelEdit(); show('daftar'); };

$('#formBaru').onsubmit = e => {
  e.preventDefault();
  const h = hitung();
  if (!h.items.length) { toast('Isi jumlah pada minimal satu layanan'); return; }
  const base = { nama: $('#nama').value.trim(), hp: $('#hp').value.trim(), items: h.items.map(({ lid, nama, satuan, harga, jumlah }) => ({ lid, nama, satuan, harga, jumlah })), subtotal: h.sub, diskon: h.diskon, total: h.total, masuk: $('#masuk').value, selesai: $('#selesai').value, catatan: $('#catatan').value.trim() };
  if (!base.nama) { toast('Nama pelanggan wajib diisi'); return; }
  let o;
  if (editId) {
    o = findO(editId); Object.assign(o, base);
  } else {
    o = Object.assign({ id: uid(), kode: nextKode(base.masuk), payments: [], status: 0, riwayat: [{ s: 0, t: new Date().toISOString() }], dibuat: new Date().toISOString(), oleh: me ? me.nama : '' }, base);
    if (h.dp > 0) o.payments.push({ id: uid(), tgl: today(), jumlah: h.dp, metode: $('#metode').value, oleh: me ? me.nama : '' });
    orders.unshift(o);
  }
  if (!saveOrders()) return;
  const baru = !editId; resetForm(); $('#filter').value = ''; $('#cari').value = o.kode; show('daftar');
  if (baru) dlgSukses(o); else toast('Perubahan disimpan');
};
function dlgSukses(o) {
  openDlg(`<h3>Pesanan tersimpan</h3>
    <dl class="ringkas-dl"><dt>Kode nota</dt><dd><strong>${o.kode}</strong></dd><dt>Pelanggan</dt><dd>${esc(o.nama)}</dd><dt>Total</dt><dd>${rp(o.total)}</dd><dt>Sisa bayar</dt><dd>${rp(sisa(o))}</dd></dl>
    <div class="aksi"><button class="utama" data-nota="${o.id}">Lihat / cetak nota</button>${waBtn(o, 'nota', 'Kirim nota via WhatsApp')}<button data-close>Tutup</button></div>`);
}

/* ---------- WhatsApp & tautan pelanggan ---------- */
function waNomor(hp) {
  let h = String(hp || '').replace(/\D/g, ''); if (!h) return '';
  if (h.startsWith('0')) h = '62' + h.slice(1); else if (h.startsWith('8')) h = '62' + h;
  return h;
}
function trackUrl(o) {
  const d = { v: 1, t: cfg.toko.nama, h: cfg.toko.hp, k: o.kode, n: (o.nama.split(/\s+/)[0] || ''), s: o.status, e: o.selesai, u: today(), p: sisa(o) };
  const b = btoa(unescape(encodeURIComponent(JSON.stringify(d)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return location.href.split('#')[0].replace(/index\.html$/, '') + '#cek=' + b;
}
function pesanStatus(o) {
  const n = o.nama, k = o.kode, T = cfg.toko.nama;
  const byr = lunas(o) ? 'Pembayaran sudah lunas.' : `Sisa pembayaran ${rp(sisa(o))}.`;
  const awal = o.status === 0 ? `Halo ${n}, cucian Anda (${k}) sudah kami terima. Estimasi selesai ${tgl(o.selesai)}.`
    : o.status === 3 ? `Halo ${n}, cucian Anda (${k}) sudah SIAP DIAMBIL. ${byr}`
    : o.status === 4 ? `Halo ${n}, terima kasih sudah mencuci di ${T}. Cucian (${k}) sudah selesai dan diambil.`
    : `Halo ${n}, cucian Anda (${k}) sedang dalam tahap: ${STATUS[o.status]}. Estimasi selesai ${tgl(o.selesai)}.`;
  return `${awal}\n\nPantau status: ${trackUrl(o)}\n\n${T}`;
}
function pesanNota(o) {
  const t = cfg.toko;
  const L = [`*${t.nama}*`, t.alamat, '', `Nota: ${o.kode}`, `Pelanggan: ${o.nama}`, `Masuk: ${tgl(o.masuk)}`, `Estimasi selesai: ${tgl(o.selesai)}`, ''];
  o.items.forEach(i => L.push(`${i.nama}\n  ${jml(i.jumlah)} ${i.satuan} x ${rp(i.harga)} = ${rp(itemTotal(i))}`));
  L.push('');
  if (o.diskon) L.push(`Diskon: -${rp(o.diskon)}`);
  L.push(`*Total: ${rp(o.total)}*`, `Dibayar: ${rp(paid(o))}`, lunas(o) ? 'Status bayar: LUNAS' : `Sisa bayar: ${rp(sisa(o))}`, '', `Pantau status: ${trackUrl(o)}`, '', t.footer);
  return L.join('\n');
}
function waBtn(o, jenis, label, kecil) {
  const teks = jenis === 'nota' ? pesanNota(o) : pesanStatus(o), h = waNomor(o.hp);
  return `<a class="btn${kecil ? ' kecil' : ''}" target="_blank" rel="noopener" href="https://wa.me/${h}?text=${encodeURIComponent(teks)}">${label}</a>`;
}

/* ---------- Daftar pesanan ---------- */
function filterOpts() {
  $('#filter').innerHTML = [['', 'Semua pesanan'], ['aktif', 'Belum selesai'], ['telat', 'Terlambat'], ['utang', 'Belum lunas']]
    .concat(STATUS.map((s, i) => ['s' + i, 'Status: ' + s])).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  $('#filter').value = 'aktif';
}
function cocok(o, f) {
  if (f === '') return true; if (f === 'aktif') return o.status < 4; if (f === 'telat') return telat(o); if (f === 'utang') return sisa(o) > 0;
  return f[0] === 's' && o.status === +f.slice(1);
}
function kartu(o) {
  const lb = [telat(o) ? '<span class="lencana merah">Terlambat</span>' : '', lunas(o) ? '<span class="lencana hijau">Lunas</span>' : (paid(o) ? `<span class="lencana kuning">DP ${rp(paid(o))}</span>` : '<span class="lencana kuning">Belum bayar</span>')].join('');
  return `<article class="kartu s${o.status}" data-id="${o.id}">
    <div class="kh"><strong>${esc(o.nama)}</strong><span class="kode">${o.kode}</span></div>
    <p>${lb}<span class="lencana">${STATUS[o.status]}</span></p>
    <ul>${o.items.map(i => `<li>${esc(i.nama)}: ${jml(i.jumlah)} ${esc(i.satuan)} = ${rp(itemTotal(i))}</li>`).join('')}</ul>
    <p><strong>${rp(o.total)}</strong><span class="mut">${o.diskon ? ` (diskon ${rp(o.diskon)})` : ''}${sisa(o) ? `, sisa ${rp(sisa(o))}` : ''}</span></p>
    <p class="mut">Masuk ${tgl(o.masuk)}, estimasi selesai ${tgl(o.selesai)}${o.hp ? ', ' + esc(o.hp) : ''}${o.oleh ? ', dicatat ' + esc(o.oleh) : ''}</p>
    ${o.catatan ? `<p class="mut">Catatan: ${esc(o.catatan)}</p>` : ''}
    <div class="aksi">
      ${o.status < 4 ? `<button class="utama kecil" data-act="next">${STATUS[o.status + 1]} &rarr;</button>` : ''}
      ${sisa(o) ? '<button class="kecil ok" data-act="bayar">Terima pembayaran</button>' : '<button class="kecil" data-act="bayar">Riwayat bayar</button>'}
      <select data-act="status" aria-label="Ubah status" class="kecil">${STATUS.map((s, i) => `<option value="${i}" ${i === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    <div class="aksi kedua">
      <button class="kecil" data-act="nota">Nota</button>
      ${o.hp ? waBtn(o, 'status', 'Kabari via WA', true) : ''}
      <button class="kecil" data-act="edit">Ubah</button>
      ${isOwner() ? '<button class="kecil bahaya" data-act="hapus">Hapus</button>' : ''}
    </div></article>`;
}
function renderDaftar() {
  const q = $('#cari').value.toLowerCase().trim(), f = $('#filter').value;
  const all = orders.filter(o => cocok(o, f) && (o.nama + ' ' + o.kode + ' ' + o.hp + ' ' + o.items.map(i => i.nama).join(' ')).toLowerCase().includes(q));
  const rowsV = all.slice(0, limit);
  $('#jumlahHasil').textContent = all.length ? `Menampilkan ${rowsV.length} dari ${all.length} pesanan` : '';
  $('#list').innerHTML = (rowsV.length ? rowsV.map(kartu).join('') : `<p class="kosong">${orders.length ? 'Tidak ada pesanan yang cocok dengan pencarian atau filter ini.' : 'Belum ada pesanan. Catat pesanan pertama di menu Kasir.'}</p>`)
    + (all.length > limit ? '<div class="aksi"><button data-act="lagi">Tampilkan lebih banyak</button></div>' : '');
}
$('#cari').oninput = () => { limit = 50; renderDaftar(); };
$('#filter').onchange = () => { limit = 50; renderDaftar(); };

function setStatus(o, s) {
  if (s === o.status) return;
  if (s === 4 && sisa(o) > 0 && !confirm(`Pesanan ${o.kode} masih punya sisa bayar ${rp(sisa(o))}. Tetap tandai selesai?`)) return false;
  o.status = s; o.riwayat.push({ s, t: new Date().toISOString() }); saveOrders();
  toast(`${o.kode}: ${STATUS[s]}`); return true;
}
$('#list').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  if (b.dataset.act === 'lagi') { limit += 50; renderDaftar(); return; }
  const o = findO(b.closest('article')?.dataset.id); if (!o) return;
  const a = b.dataset.act;
  if (a === 'next') { setStatus(o, o.status + 1); renderDaftar(); }
  if (a === 'bayar') dlgBayar(o);
  if (a === 'nota') dlgNota(o);
  if (a === 'edit') startEdit(o);
  if (a === 'hapus' && isOwner() && confirm(`Hapus pesanan ${o.kode} atas nama ${o.nama}? Tindakan ini tidak bisa dibatalkan.`)) {
    orders = orders.filter(x => x !== o); saveOrders(); renderDaftar(); toast('Pesanan dihapus');
  }
});
$('#list').addEventListener('change', e => {
  if (e.target.dataset.act !== 'status') return;
  const o = findO(e.target.closest('article').dataset.id);
  setStatus(o, +e.target.value); renderDaftar();
});

/* ---------- Pembayaran ---------- */
function dlgBayar(o) {
  const s = sisa(o);
  openDlg(`<h3>Pembayaran ${o.kode}</h3>
    <dl class="ringkas-dl"><dt>Pelanggan</dt><dd>${esc(o.nama)}</dd><dt>Total</dt><dd>${rp(o.total)}</dd><dt>Sudah dibayar</dt><dd>${rp(paid(o))}</dd><dt>Sisa</dt><dd><strong>${rp(s)}</strong></dd></dl>
    ${s ? `<form id="fBayar" data-id="${o.id}"><label>Jumlah (Rp)<input id="bJml" type="number" inputmode="numeric" min="1" max="${s}" value="${s}" required></label>
      <label>Metode<select id="bMet">${METODE.map(m => `<option>${m}</option>`).join('')}</select></label>
      <div class="aksi"><button class="utama">Catat pembayaran</button><button type="button" data-close>Tutup</button></div></form>` : '<p class="lencana hijau">Pesanan ini sudah lunas.</p>'}
    ${o.payments.length ? `<h3>Riwayat</h3>${o.payments.map(p => `<div class="baris"><span>${tgl(p.tgl)}, ${esc(p.metode)}</span><span>${rp(p.jumlah)} ${isOwner() ? `<button class="kecil bahaya" data-delpay="${p.id}" data-oid="${o.id}" aria-label="Hapus pembayaran">Hapus</button>` : ''}</span></div>`).join('')}` : ''}
    ${s ? '' : '<div class="aksi"><button data-close>Tutup</button></div>'}`);
}
dlg.addEventListener('submit', e => {
  if (e.target.id !== 'fBayar') return;
  e.preventDefault();
  const o = findO(e.target.dataset.id), j = Math.min(num($('#bJml').value), sisa(o));
  if (j <= 0) return;
  o.payments.push({ id: uid(), tgl: today(), jumlah: j, metode: $('#bMet').value, oleh: me ? me.nama : '' });
  saveOrders(); closeDlg(); renderDaftar(); renderBeranda(); toast(`Pembayaran ${rp(j)} dicatat`);
  if (lunas(o) && o.status === 3 && confirm('Pesanan lunas. Tandai selesai (cucian sudah diambil)?')) { setStatus(o, 4); renderDaftar(); }
});
dlg.addEventListener('click', e => {
  const d = e.target.closest('[data-delpay]'); if (d && isOwner()) {
    const o = findO(d.dataset.oid);
    if (confirm('Hapus catatan pembayaran ini?')) { o.payments = o.payments.filter(p => p.id !== d.dataset.delpay); saveOrders(); dlgBayar(o); renderDaftar(); }
  }
  const n = e.target.closest('[data-nota]'); if (n) dlgNota(findO(n.dataset.nota));
  const c = e.target.closest('[data-cetak]'); if (c) cetak(findO(c.dataset.cetak));
});

/* ---------- Nota ---------- */
function notaHTML(o) {
  const t = cfg.toko;
  return `<h2>${esc(t.nama)}</h2><p class="c">${esc(t.alamat)}<br>${esc(t.hp)}</p><hr>
    <p><strong>${esc(o.kode)}</strong></p><p>Pelanggan: ${esc(o.nama)}</p>
    <p>Masuk: ${tgl(o.masuk)}<br>Estimasi selesai: ${tgl(o.selesai)}</p><hr>
    ${o.items.map(i => `<div>${esc(i.nama)}</div><div class="r"><span>${jml(i.jumlah)} ${esc(i.satuan)} x ${rp(i.harga)}</span><span>${rp(itemTotal(i))}</span></div>`).join('')}<hr>
    ${o.diskon ? `<div class="r"><span>Diskon</span><span>-${rp(o.diskon)}</span></div>` : ''}
    <div class="r"><strong>Total</strong><strong>${rp(o.total)}</strong></div>
    <div class="r"><span>Dibayar</span><span>${rp(paid(o))}</span></div>
    <div class="r"><span>${lunas(o) ? 'Status' : 'Sisa bayar'}</span><strong>${lunas(o) ? 'LUNAS' : rp(sisa(o))}</strong></div>
    ${o.catatan ? `<hr><p>Catatan: ${esc(o.catatan)}</p>` : ''}<hr><p class="c">${esc(t.footer)}</p>`;
}
function dlgNota(o) {
  openDlg(`<h3>Nota ${o.kode}</h3><div class="prev">${notaHTML(o)}</div>
    <div class="aksi" style="margin-top:.8rem"><button class="utama" data-cetak="${o.id}">Cetak</button>${waBtn(o, 'nota', 'Kirim via WhatsApp')}<button data-close>Tutup</button></div>`);
}
function pageSize() {
  const w = cfg.toko.kertas === '80' ? 80 : 58;
  $('#pageStyle').textContent = `@page{size:${w}mm auto;margin:2mm}@media print{#nota{width:${w - 4}mm}}`;
}
function cetak(o) { $('#nota').innerHTML = notaHTML(o); pageSize(); document.body.classList.remove('cetak-lap'); window.print(); }

/* ---------- Laporan ---------- */
function laporan(ym) {
  const os = orders.filter(o => o.masuk.startsWith(ym));
  const omzet = os.reduce((a, o) => a + o.total, 0);
  const pays = orders.flatMap(o => o.payments.map(p => Object.assign({ o }, p))).filter(p => p.tgl.startsWith(ym));
  const diterima = pays.reduce((a, p) => a + p.jumlah, 0);
  const [y, m] = ym.split('-').map(Number), hariN = new Date(y, m, 0).getDate();
  const harian = Array.from({ length: hariN }, (_, i) => pays.filter(p => p.tgl === `${ym}-${pad(i + 1)}`).reduce((a, p) => a + p.jumlah, 0));
  const per = {}; os.forEach(o => o.items.forEach(i => { const k = i.nama + '|' + i.satuan; per[k] = per[k] || { nama: i.nama, satuan: i.satuan, qty: 0, rp: 0 }; per[k].qty += i.jumlah; per[k].rp += itemTotal(i); }));
  const metode = {}; pays.forEach(p => metode[p.metode] = (metode[p.metode] || 0) + p.jumlah);
  return { os, omzet, diterima, harian, hariN, layanan: Object.values(per).sort((a, b) => b.rp - a.rp), metode, diskon: os.reduce((a, o) => a + o.diskon, 0) };
}
function grafik(h) {
  const W = 600, H = 150, max = Math.max(...h, 1), bw = W / h.length;
  const bars = h.map((v, i) => { const bh = Math.max(v ? 2 : 0, (v / max) * (H - 28)); return `<rect x="${i * bw + 1.5}" y="${H - 18 - bh}" width="${bw - 3}" height="${bh}" rx="2"><title>Tanggal ${i + 1}: ${rp(v)}</title></rect>`; }).join('');
  const lab = h.map((_, i) => ((i + 1) % 5 === 0 || i === 0) ? `<text x="${i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${i + 1}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik pemasukan harian. Tertinggi ${rp(max)}">${bars}${lab}</svg>`;
}
function renderLaporan() {
  if (!$('#bulan').value) $('#bulan').value = today().slice(0, 7);
  const ym = $('#bulan').value, r = laporan(ym);
  $('#isiLaporan').innerHTML = `<div class="kartu-lap">
      <div><span>Jumlah pesanan</span><strong>${r.os.length}</strong></div>
      <div><span>Nilai pesanan (omzet)</span><strong>${rp(r.omzet)}</strong></div>
      <div><span>Uang diterima</span><strong>${rp(r.diterima)}</strong></div>
      <div><span>Diskon diberikan</span><strong>${rp(r.diskon)}</strong></div></div>
    <h2>Pemasukan harian</h2><div class="grafik">${grafik(r.harian)}</div>
    <h2>Per layanan</h2>${r.layanan.length ? `<table><thead><tr><th>Layanan</th><th class="n">Jumlah</th><th class="n">Nilai</th></tr></thead><tbody>${r.layanan.map(l => `<tr><td>${esc(l.nama)}</td><td class="n">${jml(l.qty)} ${esc(l.satuan)}</td><td class="n">${rp(l.rp)}</td></tr>`).join('')}</tbody></table>` : '<p class="kosong">Belum ada pesanan pada bulan ini.</p>'}
    <h2>Per metode pembayaran</h2>${Object.keys(r.metode).length ? `<table><tbody>${Object.entries(r.metode).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${rp(v)}</td></tr>`).join('')}</tbody></table>` : '<p class="kosong">Belum ada pembayaran pada bulan ini.</p>'}
    <p class="mut">Piutang seluruh pesanan saat ini: <strong>${rp(orders.reduce((a, o) => a + sisa(o), 0))}</strong>. Omzet dihitung dari tanggal masuk cucian, uang diterima dari tanggal pembayaran.</p>`;
}
$('#bulan').onchange = renderLaporan;
$('#cetakLap').onclick = () => { document.body.classList.add('cetak-lap'); window.print(); setTimeout(() => document.body.classList.remove('cetak-lap'), 500); };
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
$('#csv').onclick = () => {
  const ym = $('#bulan').value || today().slice(0, 7), r = laporan(ym);
  const head = ['Kode', 'Tanggal masuk', 'Estimasi selesai', 'Nama', 'HP', 'Layanan', 'Subtotal', 'Diskon', 'Total', 'Dibayar', 'Sisa', 'Status'];
  const lines = [head].concat(r.os.slice().reverse().map(o => [o.kode, o.masuk, o.selesai, o.nama, o.hp, o.items.map(i => `${i.nama} ${jml(i.jumlah)} ${i.satuan}`).join(' + '), o.subtotal, o.diskon, o.total, paid(o), sisa(o), STATUS[o.status]]));
  download(`laporan-laundry-${ym}.csv`, '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
};

/* ---------- Setelan ---------- */
function renderSetelan() {
  const t = cfg.toko;
  $('#tNama').value = t.nama; $('#tHp').value = t.hp; $('#tAlamat').value = t.alamat; $('#tPrefix').value = t.prefix; $('#tKertas').value = t.kertas; $('#tFooter').value = t.footer;
  svcRows(cfg.layanan);
  renderAkun();
  const kb = Math.round(((localStorage.getItem(K.orders) || '').length) / 1024);
  const b = store.get(K.bak, 0);
  $('#infoData').textContent = `${orders.length} pesanan tersimpan (sekitar ${kb} KB). Cadangan terakhir: ${b ? new Date(b).toLocaleString('id-ID') : 'belum pernah'}.`;
}
$('#formToko').onsubmit = e => {
  e.preventDefault();
  cfg = normCfg({ toko: { nama: $('#tNama').value.trim(), hp: $('#tHp').value.trim(), alamat: $('#tAlamat').value.trim(), prefix: $('#tPrefix').value, kertas: $('#tKertas').value, footer: $('#tFooter').value.trim() }, layanan: cfg.layanan });
  saveCfg(); applyToko(); renderSetelan(); toast('Data toko disimpan');
};
function svcRows(list) {
  $('#svcRows').innerHTML = list.map(l => `<div class="svc" data-id="${esc(l.id)}">
    <input data-f="nama" value="${esc(l.nama)}" aria-label="Nama layanan" placeholder="Nama layanan" maxlength="50">
    <select data-f="satuan" aria-label="Satuan">${SATUAN.concat(SATUAN.includes(l.satuan) ? [] : [l.satuan]).map(s => `<option ${s === l.satuan ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <input data-f="harga" type="number" inputmode="numeric" min="0" step="500" value="${l.harga}" aria-label="Harga" placeholder="Harga">
    <input data-f="hari" type="number" inputmode="numeric" min="0" max="60" value="${l.hari}" aria-label="Lama pengerjaan (hari)" placeholder="Hari">
    <button type="button" class="kecil bahaya" data-act="rmSvc" aria-label="Hapus layanan">Hapus</button></div>`).join('');
}
function bacaSvc() {
  return $$('#svcRows .svc').map(r => ({ id: r.dataset.id, nama: $('[data-f=nama]', r).value.trim(), satuan: $('[data-f=satuan]', r).value, harga: num($('[data-f=harga]', r).value), hari: num($('[data-f=hari]', r).value) }));
}
$('#svcTambah').onclick = () => { const l = bacaSvc(); l.push({ id: 'svc-' + uid(), nama: '', satuan: 'kg', harga: 0, hari: 2 }); svcRows(l); $$('#svcRows [data-f=nama]').pop().focus(); };
$('#svcRows').addEventListener('click', e => { if (e.target.closest('[data-act=rmSvc]')) { const r = e.target.closest('.svc'); r.remove(); } });
$('#svcSimpan').onclick = () => {
  const l = bacaSvc();
  if (l.some(x => !x.nama)) { toast('Nama layanan tidak boleh kosong'); return; }
  if (!l.length) { toast('Minimal ada satu layanan'); return; }
  cfg = normCfg({ toko: cfg.toko, layanan: l }); saveCfg(); resetForm(); renderSetelan(); toast('Layanan disimpan');
};
$('#svcReset').onclick = () => {
  if (!confirm('Kembalikan daftar layanan ke bawaan dari data/config.json? Perubahan layanan Anda akan hilang.')) return;
  cfg = normCfg({ toko: cfg.toko, layanan: defaults.layanan }); saveCfg(); resetForm(); renderSetelan(); toast('Layanan dikembalikan');
};
function applyToko() { $('#namaToko').textContent = cfg.toko.nama; $('#lockNama').textContent = cfg.toko.nama; document.title = cfg.toko.nama; pageSize(); }

/* ---------- Cadangan ---------- */
function ekspor() {
  download('cadangan-laundry-' + today() + '.json', JSON.stringify({ app: 'sistem-laundry', version: 2, exportedAt: new Date().toISOString(), config: cfg, orders }, null, 2), 'application/json');
  store.set(K.bak, Date.now()); toast('Cadangan diunduh'); if ($('#beranda').classList.contains('on')) renderBeranda(); if ($('#setelan').classList.contains('on')) renderSetelan();
}
$('#ekspor').onclick = ekspor;
$('#impor').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      const arr = Array.isArray(d) ? d : d.orders; if (!Array.isArray(arr)) throw 0;
      const list = arr.map(normOrder).filter(Boolean);
      if (arr.length && !list.length) throw 0;
      if (confirm(`Ganti SEMUA data saat ini dengan ${list.length} pesanan dari file? Disarankan unduh cadangan data saat ini lebih dulu.`)) {
        orders = list; saveOrders();
        if (d.config) { cfg = normCfg(d.config); saveCfg(); }
        applyToko(); resetForm(); renderSetelan(); toast('Data dipulihkan');
      }
    } catch (x) { alert('File tidak valid. Pilih file cadangan yang diunduh dari sistem ini.'); }
  };
  r.readAsText(f); e.target.value = '';
};
$('#hapusSemua').onclick = () => {
  if (prompt(`Ini akan menghapus ${orders.length} pesanan, pengaturan, dan semua akun pengguna. Unduh cadangan dulu.\nKetik HAPUS untuk melanjutkan.`) !== 'HAPUS') return;
  [K.orders, K.cfg, K.pin, K.bak, K.users].forEach(store.del); orders = []; users = []; cfg = normCfg(defaults); applyToko(); keluar(); toast('Semua data dihapus');
};

/* ---------- Akun, login, logout ---------- */
const ROLE = { pemilik: 'Pemilik', kasir: 'Kasir' };
let users = [], me = null;
const isOwner = () => !!me && me.role === 'pemilik';
const loadUsers = () => { const u = store.get(K.users, []); return Array.isArray(u) ? u.filter(x => x && x.id && x.username && x.hash) : []; };
const saveUsers = () => store.set(K.users, users);
const normUser = s => String(s || '').trim().toLowerCase();
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), x => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[x % 31]).join('');
const fmtCode = c => c.slice(0, 4) + '-' + c.slice(4);
async function hashPw(p, salt) {
  const enc = new TextEncoder();
  if (window.crypto && crypto.subtle) {
    const key = await crypto.subtle.importKey('raw', enc.encode(p), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
    return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (const c of enc.encode(salt + ':' + p)) h = ((h << 5) + h + c) >>> 0; return 'x' + h;
}
const setSess = id => { try { id ? sessionStorage.setItem(K.sess, id) : sessionStorage.removeItem(K.sess); } catch (e) { /* abaikan */ } };
const getSess = () => { try { return sessionStorage.getItem(K.sess); } catch (e) { return null; } };
async function buatUser(nama, username, role, pw) {
  const salt = uid(), u = { id: uid(), username, nama, role, salt, hash: await hashPw(pw, salt) };
  let rec = null; if (role === 'pemilik') { rec = newCode(); u.rec = await hashPw(rec, salt); }
  return { u, rec };
}
function dlgKode(rec, judul) {
  openDlg(`<h3>${judul}</h3><p>Simpan <strong>kode pemulihan</strong> ini di tempat aman (foto atau catat). Kode hanya muncul sekali dan dipakai bila pemilik lupa kata sandi.</p><div class="kode-pulih">${fmtCode(rec)}</div><div class="aksi" style="margin-top:.8rem"><button class="utama" data-close>Sudah saya simpan</button></div>`);
}

function gate() { // tampilkan layar masuk, atau layar buat akun pertama
  me = null; document.body.classList.add('locked'); $('#lock').hidden = false;
  const setup = !users.length; $('#fSetup').hidden = !setup; $('#fLock').hidden = setup;
  $('#fLock').reset(); $('#fSetup').reset(); $('#lockMsg').textContent = ''; $('#setupMsg').textContent = '';
  setTimeout(() => { const a = document.activeElement; if (!a || a === document.body) $(setup ? '#sNama' : '#uIn').focus(); }, 50);
}
function masuk(u) {
  me = u; setSess(u.id); rstIdle();
  document.body.classList.remove('locked'); $('#lock').hidden = true;
  document.body.classList.toggle('role-kasir', u.role !== 'pemilik');
  $('#userInfo').textContent = `${u.nama} (${ROLE[u.role]})`; $('#keluar').hidden = false;
  resetForm(); show('beranda');
}
function keluar() {
  if (editId) resetForm();
  setSess(null); closeDlg(); clearTimeout(idleT);
  ['#list', '#perhatian', '#isiLaporan', '#stat'].forEach(s => $(s).innerHTML = ''); $('#cari').value = ''; $('#nota').innerHTML = '';
  $('#keluar').hidden = true; $('#userInfo').textContent = ''; gate();
}
$('#keluar').onclick = () => { if (confirm('Keluar dari aplikasi?')) { keluar(); } };

$('#fSetup').onsubmit = async e => {
  e.preventDefault();
  const nama = $('#sNama').value.trim(), un = normUser($('#sUser').value), pw = $('#sPw').value, msg = t => { $('#setupMsg').textContent = t; };
  if (!/^[a-z0-9._-]{3,20}$/.test(un)) return msg('Nama pengguna 3 sampai 20 karakter: huruf, angka, titik, strip.');
  if (pw.length < 6) return msg('Kata sandi minimal 6 karakter.');
  if (pw !== $('#sPw2').value) return msg('Ulangi kata sandi tidak sama.');
  const { u, rec } = await buatUser(nama, un, 'pemilik', pw);
  users = [u]; saveUsers(); store.del(K.pin); masuk(u); dlgKode(rec, 'Akun pemilik dibuat');
};
let salah = 0, tunda = 0;
$('#fLock').onsubmit = async e => {
  e.preventDefault();
  if (Date.now() < tunda) { $('#lockMsg').textContent = `Terlalu banyak percobaan. Tunggu ${Math.ceil((tunda - Date.now()) / 1000)} detik.`; return; }
  const u = users.find(x => x.username === normUser($('#uIn').value)), pw = $('#pwIn').value;
  const h = await hashPw(pw, u ? u.salt : 'x'); // tetap hitung agar waktu respons sama
  if (u && h === u.hash) { salah = 0; masuk(u); return; }
  salah++; $('#pwIn').value = ''; $('#lockMsg').textContent = 'Nama pengguna atau kata sandi salah.';
  if (salah >= 5) { tunda = Date.now() + 30000; salah = 0; }
};
$('#lupa').onclick = () => openDlg(`<h3>Lupa kata sandi pemilik</h3><p class="mut">Masukkan kode pemulihan yang disimpan saat akun pemilik dibuat. Pengguna kasir minta pemilik mengatur ulang kata sandinya.</p>
  <form id="fPulih" autocomplete="off"><label>Kode pemulihan<input id="rKode" required maxlength="9" placeholder="XXXX-XXXX"></label>
  <label>Kata sandi baru (minimal 6 karakter)<input id="rPw" type="password" minlength="6" autocomplete="new-password" required></label>
  <p id="rMsg" class="galat" role="alert"></p><div class="aksi"><button class="utama">Atur ulang</button><button type="button" data-close>Batal</button></div></form>`);

/* kelola pengguna */
function renderAkun() {
  if (!me) return;
  let h = `<p>Masuk sebagai <strong>${esc(me.nama)}</strong> (${ROLE[me.role]}, @${esc(me.username)})</p>
    <div class="aksi"><button data-act="ganti">Ganti kata sandi</button><button data-act="keluar">Keluar</button></div>`;
  if (isOwner()) {
    h += `<h3 style="margin-top:1.2rem">Semua pengguna</h3>` + users.map(u => `<div class="baris"><div><strong>${esc(u.nama)}</strong> <small>@${esc(u.username)}, ${ROLE[u.role]}</small></div>
      <div class="aksi">${u.id !== me.id ? `<button class="kecil" data-act="reset" data-id="${u.id}">Atur ulang sandi</button><button class="kecil bahaya" data-act="hapusU" data-id="${u.id}">Hapus</button>` : '<small>Anda</small>'}</div></div>`).join('')
      + `<div class="aksi"><button class="utama" data-act="tambahU">+ Tambah pengguna</button></div>
      <p class="mut">Kasir bisa mencatat pesanan dan menerima pembayaran, tetapi tidak bisa menghapus data, melihat laporan, atau mengubah setelan.</p>`;
  }
  h += '<p class="mut">Akun disimpan di browser perangkat ini. Login ini menutup akses ke aplikasi, tetapi bukan pengganti keamanan server.</p>';
  $('#boxAkun').innerHTML = h;
}
function dlgUser(mode, id) {
  const u = users.find(x => x.id === id);
  const judul = { tambah: 'Tambah pengguna', reset: 'Atur ulang kata sandi' + (u ? ': ' + esc(u.nama) : ''), ganti: 'Ganti kata sandi' }[mode];
  openDlg(`<h3>${judul}</h3><form id="fUser" data-mode="${mode}" data-id="${esc(id || '')}" autocomplete="off">
    ${mode === 'tambah' ? `<label>Nama lengkap<input id="uNama" required maxlength="40"></label>
      <label>Nama pengguna<input id="uUser" required maxlength="20" pattern="[A-Za-z0-9._\\-]{3,20}" title="3 sampai 20 huruf atau angka" autocapitalize="none"></label>
      <label>Peran<select id="uRole"><option value="kasir">Kasir</option><option value="pemilik">Pemilik (akses penuh)</option></select></label>` : ''}
    ${mode === 'ganti' ? '<label>Kata sandi saat ini<input id="uLama" type="password" autocomplete="current-password" required></label>' : ''}
    <label>Kata sandi ${mode === 'ganti' ? 'baru ' : ''}(minimal 6 karakter)<input id="uPw" type="password" minlength="6" autocomplete="new-password" required></label>
    <label>Ulangi kata sandi<input id="uPw2" type="password" minlength="6" autocomplete="new-password" required></label>
    <p id="uMsg" class="galat" role="alert"></p><div class="aksi"><button class="utama">Simpan</button><button type="button" data-close>Batal</button></div></form>`);
}
$('#boxAkun').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act, id = b.dataset.id;
  if (a === 'keluar') $('#keluar').click();
  if (a === 'ganti') dlgUser('ganti');
  if (!isOwner()) return;
  if (a === 'tambahU') dlgUser('tambah');
  if (a === 'reset') dlgUser('reset', id);
  if (a === 'hapusU') {
    const u = users.find(x => x.id === id);
    if (u && u.id !== me.id && confirm(`Hapus pengguna ${u.nama}? Pesanan yang pernah dicatat tetap tersimpan.`)) { users = users.filter(x => x !== u); saveUsers(); renderAkun(); toast('Pengguna dihapus'); }
  }
});
dlg.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id === 'fUser') {
    e.preventDefault();
    const mode = f.dataset.mode, msg = t => { $('#uMsg').textContent = t; };
    if (!me || (mode !== 'ganti' && !isOwner())) return;
    const pw = $('#uPw').value; if (pw.length < 6) return msg('Kata sandi minimal 6 karakter.');
    if (pw !== $('#uPw2').value) return msg('Ulangi kata sandi tidak sama.');
    if (mode === 'ganti') {
      if ((await hashPw($('#uLama').value, me.salt)) !== me.hash) return msg('Kata sandi saat ini salah.');
      me.hash = await hashPw(pw, me.salt);
    }
    if (mode === 'reset') {
      const u = users.find(x => x.id === f.dataset.id); if (!u) return;
      u.hash = await hashPw(pw, u.salt);
    }
    if (mode === 'tambah') {
      const un = normUser($('#uUser').value), nama = $('#uNama').value.trim();
      if (!/^[a-z0-9._-]{3,20}$/.test(un)) return msg('Nama pengguna 3 sampai 20 karakter: huruf, angka, titik, strip.');
      if (users.some(x => x.username === un)) return msg('Nama pengguna sudah dipakai.');
      const { u, rec } = await buatUser(nama, un, $('#uRole').value, pw); users.push(u); saveUsers(); renderAkun();
      return rec ? dlgKode(rec, `Pemilik ${esc(nama)} ditambahkan`) : (closeDlg(), toast('Pengguna ditambahkan'));
    }
    saveUsers(); closeDlg(); renderAkun(); toast('Kata sandi disimpan');
  }
  if (f.id === 'fPulih') {
    e.preventDefault();
    const k = $('#rKode').value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); let hit = null;
    for (const u of users.filter(x => x.rec)) if ((await hashPw(k, u.salt)) === u.rec) { hit = u; break; }
    if (!hit) return $('#rMsg').textContent = 'Kode pemulihan salah.';
    hit.hash = await hashPw($('#rPw').value, hit.salt); const r = newCode(); hit.rec = await hashPw(r, hit.salt);
    saveUsers(); masuk(hit); dlgKode(r, 'Kata sandi diatur ulang');
  }
});

/* keluar otomatis bila ditinggalkan */
let idleT, hiddenAt = 0;
function rstIdle() { clearTimeout(idleT); if (me) idleT = setTimeout(() => { if (me) { keluar(); toast('Keluar otomatis karena tidak aktif'); } }, 30 * 60e3); }
['click', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => { if (me) rstIdle(); }, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && me && Date.now() - hiddenAt > 5 * 60e3) keluar();
});

/* ---------- Halaman pelanggan (tautan status) ---------- */
function tampilPelanggan() {
  let d = null;
  try {
    let b = location.hash.slice(5).replace(/-/g, '+').replace(/_/g, '/'); b += '='.repeat((4 - b.length % 4) % 4);
    d = JSON.parse(decodeURIComponent(escape(atob(b))));
  } catch (e) { d = null; }
  const box = $('#pelanggan'); document.body.classList.add('cust'); box.hidden = false;
  if (!d || typeof d.k !== 'string' || typeof d.t !== 'string') { box.innerHTML = '<div class="kartu-pel"><h1>Tautan tidak valid</h1><p class="mut">Minta tautan baru dari pihak laundry.</p></div>'; return; }
  const s = Math.min(4, Math.max(0, Math.round(Number(d.s) || 0))), h = waNomor(d.h), sr = Math.max(0, Number(d.p) || 0);
  document.title = 'Status ' + d.k;
  box.innerHTML = `<div class="kartu-pel kartu s${s}"><h1>${esc(d.t)}</h1>
    <p>Halo${d.n ? ' ' + esc(d.n) : ''}, ini status cucian Anda.</p><p class="kode">Kode nota: <strong>${esc(d.k)}</strong></p>
    <ol class="langkah">${STATUS.map((x, i) => `<li class="${i < s ? 'lalu' : i === s ? 'kini' : ''}">${x}</li>`).join('')}</ol>
    <p><strong>${STATUS[s]}</strong>${s < 4 ? `, estimasi selesai ${tgl(d.e)}` : ''}</p>
    <p class="mut">${sr ? `Sisa pembayaran ${rp(sr)}, dibayar saat pengambilan.` : 'Pembayaran sudah lunas.'}</p>
    <p class="mut">Status per ${tgl(d.u)}. Halaman ini adalah salinan saat pesan dikirim; hubungi kami untuk info terbaru.</p>
    ${h ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${h}?text=${encodeURIComponent('Halo, saya ingin menanyakan cucian ' + d.k)}">Hubungi kami via WhatsApp</a>` : ''}</div>`;
}

/* ---------- Mulai ---------- */
async function init() {
  if (location.hash.startsWith('#cek=')) { tampilPelanggan(); return; }
  try { const r = await fetch('data/config.json', { cache: 'no-cache' }); if (!r.ok) throw 0; defaults = normCfg(await r.json()); }
  catch (e) { defaults = normCfg(DEFAULT_CONFIG); } // dipakai bila file dibuka langsung tanpa server
  cfg = store.get(K.cfg, null) ? normCfg(store.get(K.cfg, null)) : clone(defaults);
  orders = loadOrders();
  users = loadUsers(); filterOpts(); applyToko(); resetForm();
  const sesi = users.find(x => x.id === getSess()); if (sesi) masuk(sesi); else gate();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#cek=')) tampilPelanggan(); else if (document.body.classList.contains('cust')) location.reload(); });
init();
