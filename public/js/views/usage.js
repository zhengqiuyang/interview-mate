/* Token 用量面板（大弹窗：总量/趋势/场景分布/费用/明细） */
import { $, esc, icon, toast, openModal, confirmModal, downloadFile } from '../core.js';
import { tokenStats, daySeries, clearTokens, exportTokens, estimateCost, MODE_NAMES } from '../tokens.js';

export function openUsagePanel() {
  const st = tokenStats();
  const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
  const total = st.total.p + st.total.c;
  const modes = Object.entries(st.byMode).sort((a, b) => (b[1].p + b[1].c) - (a[1].p + a[1].c));
  const maxMode = Math.max(...modes.map(([, v]) => v.p + v.c), 1);
  const series = daySeries(14);
  const maxDay = Math.max(...series.map((d) => d.p + d.c), 1);
  const cost = estimateCost(st);
  const models = Object.keys(st.byModel);

  const m = openModal(`
    <div class="tiles" style="margin-bottom:14px">
      <div class="tile"><div class="tile-ico">${icon('cpu', 20)}</div>
        <div><div class="tile-num">${fmt(total)}</div><div class="tile-label">累计 Tokens</div></div></div>
      <div class="tile"><div class="tile-ico ok">${icon('zap', 20)}</div>
        <div><div class="tile-num">${fmt(st.today.p + st.today.c)}</div><div class="tile-label">今日 · ${st.today.n} 次</div></div></div>
      <div class="tile"><div class="tile-ico warn">${icon('calendar', 20)}</div>
        <div><div class="tile-num">${fmt(st.month.p + st.month.c)}</div><div class="tile-label">本月 · ${st.month.n} 次</div></div></div>
      <div class="tile"><div class="tile-ico gold">${icon('coins', 20)}</div>
        <div><div class="tile-num">${cost != null ? '$' + cost.toFixed(cost < 1 ? 3 : 2) : '—'}</div><div class="tile-label">费用粗估${cost === 0 ? '（免费模型）' : ''}</div></div></div>
    </div>
    <div class="dash-grid2">
      <div>
        <div class="muted" style="font-size:12px;font-weight:700;letter-spacing:.1em;margin-bottom:6px">最近 14 天</div>
        <div style="display:flex;align-items:flex-end;gap:5px;height:110px">
          ${series.map((d) => `
            <div class="tok-col" title="${d.label}：输入 ${fmt(d.p)} / 输出 ${fmt(d.c)}">
              <div class="tok-stack">
                <i class="tok-c" style="height:${(d.c / maxDay) * 90}px"></i>
                <i class="tok-p" style="height:${(d.p / maxDay) * 90}px"></i>
              </div>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:14px;margin-top:8px;font-size:11.5px;color:var(--muted)">
          <span><i class="dot" style="background:var(--brand)"></i> 输入</span>
          <span><i class="dot" style="background:var(--brand-2)"></i> 输出</span>
        </div>
      </div>
      <div>
        <div class="muted" style="font-size:12px;font-weight:700;letter-spacing:.1em;margin-bottom:6px">场景分布</div>
        ${modes.length ? modes.map(([k, v]) => `
          <div class="cat-row" style="grid-template-columns:88px 1fr 96px">
            <span>${esc(MODE_NAMES[k] || k)}</span>
            <div class="bar"><i style="width:${((v.p + v.c) / maxMode) * 100}%"></i></div>
            <span class="val"><b>${fmt(v.p + v.c)}</b> · ${v.n}次</span>
          </div>`).join('') : '<p class="hint">还没有记录</p>'}
      </div>
    </div>
    <div style="margin-top:14px">
      <div class="muted" style="font-size:12px;font-weight:700;letter-spacing:.1em;margin-bottom:6px">最近请求</div>
      <div class="tok-table">
        ${st.recent.length ? st.recent.map((e) => `
          <div class="tok-row">
            <span class="muted">${new Date(e.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <span>${esc(MODE_NAMES[e.m] || e.m)}</span>
            <span class="muted">${esc(e.mo || '-')}</span>
            <span>入 ${fmt(e.p)}</span><span>出 ${fmt(e.c)}</span>
            <span class="badge ${e.e ? 'warn' : 'ok'}">${e.e ? '估算' : '精确'}</span>
          </div>`).join('') : '<p class="hint">发起任何 AI 请求后，这里会出现逐笔记录（最多保留 600 条）。</p>'}
      </div>
    </div>
    <div class="actions" style="justify-content:space-between">
      <span class="hint" style="margin:0">模型：${models.length ? esc(models.join('、')) : '—'}；精确值来自接口 usage 字段，缺失时本地估算并标注<br>
      服务端定时简报：<span id="server-tok">读取中…</span></span>
      <span>
        <button class="btn small ghost" id="tok-export">${icon('download', 13)}导出</button>
        <button class="btn small danger" id="tok-clear">${icon('trash', 13)}清空</button>
      </span>
    </div>`,
    { title: 'Token 用量', icon: 'cpu', width: 880 });

  // 服务端定时简报的累计用量
  fetch('/api/agent/briefs').then((r) => r.json()).then((j) => {
    const el = $('#server-tok', m.el);
    if (el && j.serverTokens) {
      const t = j.serverTokens;
      el.textContent = t.n ? `${t.n} 次 · 入 ${fmt(t.p)} / 出 ${fmt(t.c)}` : '暂无调用';
    } else if (el) el.textContent = '不可用';
  }).catch(() => { const el = $('#server-tok', m.el); if (el) el.textContent = '不可用'; });

  $('#tok-export', m.el).onclick = () => {
    downloadFile('interview-mate-tokens.json', exportTokens(), 'application/json');
    toast('已导出', 'ok');
  };
  $('#tok-clear', m.el).onclick = async () => {
    if (!(await confirmModal('清空全部 Token 用量记录？'))) return;
    clearTokens();
    m.close();
    openUsagePanel();
    toast('已清空', 'ok');
  };
  return m;
}
