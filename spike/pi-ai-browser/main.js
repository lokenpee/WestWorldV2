// THROWAWAY SPIKE — 验证 @earendil-works/pi-ai 能否在浏览器里运行
const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const report = { stages: [], ok: null, error: null };

function log(stage, payload) {
  report.stages.push({ stage, ...payload });
  logEl.textContent += `\n[${stage}] ${JSON.stringify(payload, null, 2)}`;
}
function done(ok, extra = {}) {
  report.ok = ok; Object.assign(report, extra);
  statusEl.textContent = ok ? 'DONE' : 'FAILED';
  window.__SPIKE_RESULT__ = report;
}

(async () => {
  try {
    const { createModels } = await import('@earendil-works/pi-ai/models');
    const { deepseekProvider } = await import('@earendil-works/pi-ai/providers/deepseek');
    log('1-import', { ok: true });

    const models = createModels();
    const provider = deepseekProvider();
    models.setProvider(provider);
    log('2-provider', { ok: true, id: provider.id, baseUrl: provider.baseUrl });

    const ids = models.getModels('deepseek').map(m => m.id);
    log('3-catalog', { ok: ids.length > 0, count: ids.length, ids });
    if (!ids.length) return done(false, { error: 'catalog empty' });

    // ── Stage 4: 真实网络请求（假 key）─────────────────────────
    // 检查 fetch 是否真的发到了 api.deepseek.com
    const calls = [];
    const origFetch = window.fetch;
    window.fetch = async (...a) => {
      const url = typeof a[0] === 'string' ? a[0] : a[0]?.url;
      const started = performance.now();
      try {
        const r = await origFetch(...a);
        calls.push({ url, status: r.status, ms: Math.round(performance.now() - started) });
        return r;
      } catch (e) {
        calls.push({ url, threw: String(e?.message || e), ms: Math.round(performance.now() - started) });
        throw e;
      }
    };

    const model = models.getModel('deepseek', ids[0]);
    const t0 = performance.now();
    let res;
    try {
      res = await models.complete(model, {
        messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }]
      }, { apiKey: 'sk-invalid-spike-key' });
    } catch (e) {
      log('4-complete-threw', { name: e?.name, message: String(e?.message || e), fetchCalls: calls });
      window.fetch = origFetch;
      return done(true, { modelId: ids[0], threw: true, fetchCalls: calls });
    }
    window.fetch = origFetch;

    log('4-complete-returned', {
      ms: Math.round(performance.now() - t0),
      stopReason: res?.stopReason,
      errorMessage: res?.errorMessage,
      error: res?.error ? String(res.error) : undefined,
      fetchCalls: calls,
      contentPreview: JSON.stringify(res?.content)?.slice(0, 400)
    });

    const reachedNetwork = calls.length > 0 && calls.some(c => typeof c.status === 'number' || c.threw);
    done(true, { modelId: ids[0], fetchCalls: calls, reachedNetwork });
  } catch (e) {
    log('fatal', { error: String(e), stack: e?.stack });
    done(false, { error: String(e) });
  }
})();
