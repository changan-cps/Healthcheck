/* Audio recorder dialog (MediaRecorder). Stops honestly when the app is hidden or the screen locks. */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < c.length; i++) if (MediaRecorder.isTypeSupported(c[i])) return c[i];
    return '';
  }

  App.recordAudio = function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder)
      return Promise.reject(new Error('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการบันทึกเสียงในหน้าเว็บ'));
    return new Promise(function (resolve, reject) {
      var stream = null, rec = null, chunks = [], t0 = 0, timer = null, result = null, stoppedBy = '';
      var MAX = 10 * 60;
      function cleanup() { clearInterval(timer); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide); }
      function onHide() { if (document.hidden && rec && rec.state === 'recording') { stoppedBy = 'hidden'; rec.stop(); } }
      App.dialog({
        title: 'บันทึกเสียงสัมภาษณ์',
        body: '<div class="rec"><p class="hint">ระบบจะขออนุญาตใช้ไมโครโฟนเมื่อกดเริ่ม • ถ้าสลับแอปหรือล็อกหน้าจอ การบันทึกจะหยุดทันที</p>' +
          '<div class="rec-time" id="rec-time" aria-live="polite">00:00</div><div id="rec-msg" role="status"></div>' +
          '<div class="rec-btns"><button class="btn btn-primary" id="rec-start">' + App.icon('mic') + 'เริ่มบันทึก</button><button class="btn btn-danger" id="rec-stop" hidden>' + App.icon('stop') + 'หยุด</button></div>' +
          '<audio id="rec-play" controls hidden></audio></div>',
        actions: [{ label: 'ยกเลิก', value: false }, { label: 'ใช้เสียงนี้เป็นหลักฐาน', kind: 'primary', value: true, onClick: function (w) { if (!result) { w.querySelector('#rec-msg').innerHTML = '<p class="field-error">ยังไม่มีเสียงที่บันทึก</p>'; return false; } } }],
        onOpen: function (w) {
          var bStart = w.querySelector('#rec-start'), bStop = w.querySelector('#rec-stop'), msg = w.querySelector('#rec-msg'), time = w.querySelector('#rec-time'), play = w.querySelector('#rec-play');
          bStart.onclick = function () {
            bStart.disabled = true; msg.innerHTML = '';
            navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
              stream = s; chunks = []; result = null; play.hidden = true; stoppedBy = '';
              var mime = pickMime();
              rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
              rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
              rec.onstop = function () {
                var dur = Math.round((Date.now() - t0) / 1000);
                var type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
                var blob = new Blob(chunks, { type: type });
                cleanup();
                result = { blob: blob, mime: type, duration: dur, name: 'interview-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + (type === 'audio/mp4' ? '.m4a' : type === 'audio/ogg' ? '.ogg' : '.webm') };
                play.src = URL.createObjectURL(blob); play.hidden = false;
                bStop.hidden = true; bStart.hidden = false; bStart.disabled = false; bStart.lastChild.textContent = 'บันทึกใหม่';
                msg.innerHTML = stoppedBy === 'hidden' ? '<p class="notice notice-warn">การบันทึกหยุดเพราะสลับแอปหรือล็อกหน้าจอ — ได้เสียงยาว ' + App.fmtTime(dur) + '</p>' :
                  stoppedBy === 'max' ? '<p class="notice notice-warn">ครบเวลาสูงสุด 10 นาที</p>' : '<p class="notice notice-info">บันทึกแล้ว ' + App.fmtTime(dur) + ' (' + (blob.size / 1048576).toFixed(1) + ' MB) — ฟังทวนได้ก่อนใช้</p>';
                if (blob.size > App.state.md.limits.AUDIO_MAX_BYTES) { msg.innerHTML = '<p class="notice notice-bad">ไฟล์ใหญ่เกิน 15 MB — บันทึกสั้นลงหรือแบ่งเป็นหลายไฟล์</p>'; result = null; }
              };
              rec.start(1000); t0 = Date.now();
              bStart.hidden = true; bStop.hidden = false; bStop.focus();
              timer = setInterval(function () { var sec = Math.round((Date.now() - t0) / 1000); time.textContent = App.fmtTime(sec); if (sec >= MAX) { stoppedBy = 'max'; rec.stop(); } }, 500);
              document.addEventListener('visibilitychange', onHide); window.addEventListener('pagehide', onHide);
            }, function (err) {
              bStart.disabled = false;
              var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
              msg.innerHTML = '<p class="notice notice-bad">' + esc(denied ? 'ไม่ได้รับอนุญาตใช้ไมโครโฟน — อนุญาตในการตั้งค่าเบราว์เซอร์ หรือเลือกไฟล์เสียง/พิมพ์ข้อความแทน' : 'เปิดไมโครโฟนไม่สำเร็จ: ' + (err && err.message)) + '</p>';
            });
          };
          bStop.onclick = function () { if (rec && rec.state === 'recording') rec.stop(); };
        }
      }).then(function (ok) {
        if (rec && rec.state === 'recording') { stoppedBy = 'cancel'; try { rec.stop(); } catch (e) { /* ignore */ } }
        cleanup();
        resolve(ok ? result : null);
      }, reject);
    });
  };
})();
