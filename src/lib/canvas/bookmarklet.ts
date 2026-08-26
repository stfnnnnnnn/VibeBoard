export function buildBookmarkletHref(code: string, vibeboardOrigin: string): string {
  const script = `
(function(){
  var CODE = ${JSON.stringify(code)};
  var VIBEBOARD_ORIGIN = ${JSON.stringify(vibeboardOrigin)};
  (async function(){
    try {
      var raw = (document.cookie.match(/(?:^|;\\s*)_csrf_token=([^;]+)/) || [])[1];
      var csrf = raw ? decodeURIComponent(raw) : '';
      var headers = {
        'Accept': 'application/json+canvas-string-ids, application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json'
      };
      var listRes = await fetch('/api/v1/users/self/user_generated_tokens?per_page=100', { credentials: 'same-origin', headers: headers });
      var existing = await listRes.json();
      var oldTokens = Array.isArray(existing) ? existing.filter(function(t){ return t.purpose === 'VibeBoard'; }) : [];
      var createRes = await fetch('/api/v1/users/self/tokens', {
        method: 'POST', credentials: 'same-origin', headers: headers,
        body: JSON.stringify({ token: { purpose: 'VibeBoard', expires_at: new Date(Date.now() + 89 * 24 * 60 * 60 * 1000).toISOString() } })
      });
      if (!createRes.ok) throw new Error('Canvas rejected the token request (status ' + createRes.status + ')');
      var created = await createRes.json();
      for (var i = 0; i < oldTokens.length; i++) {
        if (oldTokens[i].id !== created.id) {
          await fetch('/api/v1/users/self/tokens/' + oldTokens[i].id, { method: 'DELETE', credentials: 'same-origin', headers: headers });
        }
      }
      var pairRes = await fetch(VIBEBOARD_ORIGIN + '/api/canvas/pair', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: CODE, base_url: location.origin, access_token: created.visible_token, expires_at: created.expires_at })
      });
      var pairData = await pairRes.json();
      if (!pairRes.ok) throw new Error(pairData.error || 'VibeBoard rejected the token');
      alert('Connected VibeBoard to Canvas as ' + pairData.canvas_user_name + '. You can close this tab and go back to VibeBoard.');
    } catch (err) {
      alert('VibeBoard connect failed: ' + err.message + '\\n\\nGo back to VibeBoard and try again.');
    }
  })();
})();
`;
  return 'javascript:' + script.replace(/\s+/g, ' ').trim();
}
