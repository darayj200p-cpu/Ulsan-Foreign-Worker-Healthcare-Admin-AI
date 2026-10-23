'use strict';

/**
 * 울산 외국인 근로자 AI 의료상담 & 센터 연계 도구 — 화면 동작
 *
 * 보안 규칙 (PRD 6.3)
 *  - AI 응답 문자열은 textContent(텍스트 노드)로만 출력, innerHTML 사용 금지
 *  - 요소는 document.createElement로 만들고 replaceChildren()으로 비움
 */
(() => {
  /* ──────────────────────────────────────────────
   * 1. 상수
   * ────────────────────────────────────────────── */
  const API_ENDPOINT = '/api/analyze';
  const CLIENT_TIMEOUT_MS = 300 * 1000;   // 서버 최대 실행 시간과 동일
  const TOAST_DURATION_MS = 2500;         // 토스트 표시 시간 2.5초
  const STORAGE_KEY = 'accessCode';

  const MSG = Object.freeze({
    REQUIRED: '필수 선택 항목과 AI 전송 동의를 완료해 주세요.',
    COPY_OK: '전체 결과를 클립보드에 복사했습니다.',
    COPY_FAIL: '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.',
    ACCESS_CODE_FORMAT: '접속 코드는 영문, 숫자, 기호로만 입력해 주세요.',
    GENERIC: '분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    TIMEOUT: '분석 시간이 너무 오래 걸려 중단되었습니다. 다시 시도해 주세요.',
    PARSE: 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.',
    NETWORK: '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  });

  /* 언어 선택지: value는 서버(api/analyze.js) 허용 목록과 일치해야 함 */
  const LANGUAGE_OPTIONS = [
    { value: 'Vietnamese', label: 'Tiếng Việt (베트남어)' },
    { value: 'Indonesian', label: 'Bahasa Indonesia (인도네시아어)' },
    { value: 'Mongolian', label: 'Монгол хэл (몽골어)' },
    { value: 'English', label: 'English (영어)' },
    { value: 'Thai', label: 'ภาษาไทย (태국어)' },
    { value: 'Uzbek', label: 'Oʻzbek tili (우즈베크어)' },
    { value: 'Nepali', label: 'नेपाली (네팔어)' },
    { value: 'Khmer', label: 'ភាសាខ្មែរ (크메르어)' },
    { value: 'Burmese', label: 'မြန်မာဘာသာ (미얀마어)' },
    { value: 'Sinhala', label: 'සිංහල (싱할라어)' },
    { value: 'Chinese', label: '中文 (중국어)' },
    { value: 'Filipino', label: 'Filipino (필리핀어)' },
  ];

  /* 상황 선택 그룹: value는 서버 허용 목록과 일치해야 함 */
  const OPTION_GROUPS = [
    {
      name: 'bodyPart',
      options: [
        { value: '손/손가락', icon: '✋' },
        { value: '눈', icon: '👁️' },
        { value: '허리/다리', icon: '🦵' },
        { value: '머리', icon: '🤕' },
        { value: '피부/화상', icon: '🔥' },
        { value: '기타', icon: '➕' },
      ],
    },
    {
      name: 'situation',
      options: [
        { value: '작업 중 끼임/절단', icon: '⚙️' },
        { value: '낙상/추락', icon: '🪜' },
        { value: '용접/광선 노출', icon: '⚡' },
        { value: '화학물질 접촉', icon: '🧪' },
        { value: '통증/질환', icon: '🤒' },
      ],
    },
    {
      name: 'location',
      options: [
        { value: '공장/작업장', icon: '🏭' },
        { value: '야외 현장', icon: '🏗️' },
        { value: '숙소/집', icon: '🏠' },
      ],
    },
    {
      name: 'ulsanDistrict',
      options: [
        { value: '남구', icon: '📍' },
        { value: '동구', icon: '📍' },
        { value: '북구', icon: '📍' },
        { value: '중구', icon: '📍' },
        { value: '울주군', icon: '📍' },
      ],
    },
  ];

  /* 복사 서식의 제목 (PRD 6.2) */
  const COPY_SECTIONS = [
    { key: 'card1_medical_report', title: '[의료진 제시용 한국어 증상 진안서]' },
    { key: 'card2_patient_guide', title: '[근로자 전달용 자국어 내원 가이드]' },
    { key: 'card3_center_log', title: '[외국인지원센터 제출용 상담 일지]' },
  ];

  /* ──────────────────────────────────────────────
   * 2. 요소 참조와 상태
   * ────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const els = {
    language: $('language'),
    consent: $('consent'),
    additionalText: $('additionalText'),
    accessCodeSection: $('accessCodeSection'),
    accessCode: $('accessCode'),
    analyzeBtn: $('analyzeBtn'),
    loading: $('loading'),
    errorBox: $('errorBox'),
    results: $('results'),
    copyBtn: $('copyBtn'),
    card1: $('card1'),
    card2: $('card2'),
    card3: $('card3'),
    toast: $('toast'),
  };

  let lastResult = null;   // 복사용 마지막 결과
  let toastTimer = null;   // 토스트 숨김 타이머
  let isSubmitting = false; // 중복 요청 방지

  /* ──────────────────────────────────────────────
   * 3. 화면 구성 (createElement만 사용)
   * ────────────────────────────────────────────── */

  /** 언어 드롭다운 채우기 */
  function renderLanguageOptions() {
    els.language.replaceChildren();
    for (const lang of LANGUAGE_OPTIONS) {
      const option = document.createElement('option');
      option.value = lang.value;
      option.textContent = lang.label;
      els.language.appendChild(option);
    }
  }

  /** 라디오 버튼 하나를 선택 카드(칩) 모양으로 생성 */
  function createChoice(groupName, option) {
    const label = document.createElement('label');
    label.className = 'cursor-pointer';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = groupName;
    input.value = option.value;
    input.className = 'peer sr-only';

    const chip = document.createElement('span');
    chip.className = [
      'flex h-full min-h-[3.25rem] items-center justify-center gap-2 rounded-xl border px-3 py-3',
      'border-slate-200 bg-white text-center text-sm font-medium text-slate-700',
      'transition hover:border-indigo-300 hover:bg-indigo-50',
      'peer-checked:border-indigo-600 peer-checked:bg-indigo-600 peer-checked:text-white',
      'peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400 peer-focus-visible:ring-offset-2',
    ].join(' ');

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = option.icon;

    const text = document.createElement('span');
    text.textContent = option.value;

    chip.append(icon, text);
    label.append(input, chip);
    return label;
  }

  /** 상황 선택 그룹 전체 생성 */
  function renderOptionGroups() {
    for (const group of OPTION_GROUPS) {
      const container = $(`group-${group.name}`);
      if (!container) continue;
      container.replaceChildren();
      for (const option of group.options) {
        container.appendChild(createChoice(group.name, option));
      }
    }
  }

  /* ──────────────────────────────────────────────
   * 4. 표시 도우미
   * ────────────────────────────────────────────── */

  /** 토스트 알림 (2.5초 후 자동으로 사라짐) */
  function showToast(message, tone = 'info') {
    const toneClass = { info: 'bg-slate-900', success: 'bg-emerald-600', error: 'bg-red-600' }[tone] || 'bg-slate-900';
    els.toast.classList.remove('bg-slate-900', 'bg-emerald-600', 'bg-red-600', 'opacity-0', 'translate-y-2');
    els.toast.classList.add(toneClass, 'opacity-100', 'translate-y-0');
    els.toast.textContent = message;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('opacity-100', 'translate-y-0');
      els.toast.classList.add('opacity-0', 'translate-y-2');
    }, TOAST_DURATION_MS);
  }

  function showError(message) {
    els.errorBox.textContent = message;
    els.errorBox.classList.remove('hidden');
  }

  function hideError() {
    els.errorBox.replaceChildren();
    els.errorBox.classList.add('hidden');
  }

  function hideResults() {
    els.results.classList.add('hidden');
    [els.card1, els.card2, els.card3].forEach((card) => card.replaceChildren());
    lastResult = null;
  }

  /** 요청 중 상태 전환: 버튼 비활성화 + 로딩 표시 */
  function setLoading(loading) {
    isSubmitting = loading;
    els.analyzeBtn.disabled = loading;
    els.analyzeBtn.setAttribute('aria-busy', String(loading));
    els.loading.classList.toggle('hidden', !loading);
    els.loading.classList.toggle('flex', loading);
  }

  /** AI 문자열을 텍스트 노드로만 출력 */
  function renderText(target, text) {
    target.replaceChildren(document.createTextNode(text));
  }

  function renderResults(result) {
    renderText(els.card1, result.card1_medical_report);
    renderText(els.card2, result.card2_patient_guide);
    renderText(els.card3, result.card3_center_log);
    lastResult = result;
    els.results.classList.remove('hidden');
    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ──────────────────────────────────────────────
   * 5. 접속 코드 (sessionStorage는 차단될 수 있어 try/catch)
   * ────────────────────────────────────────────── */
  function readStoredCode() {
    try { return sessionStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
  }
  function storeCode(code) {
    try { if (code) sessionStorage.setItem(STORAGE_KEY, code); } catch { /* 저장 불가 시 무시 */ }
  }
  function clearStoredCode() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* 무시 */ }
  }
  /** 입력칸 값 우선, 없으면 sessionStorage 값 */
  function getAccessCode() {
    return els.accessCode.value.trim() || readStoredCode();
  }
  function showAccessCodeField() {
    els.accessCodeSection.classList.remove('hidden');
    els.accessCode.focus();
  }

  /* ──────────────────────────────────────────────
   * 6. 분석 요청
   * ────────────────────────────────────────────── */
  const getChecked = (name) => {
    const input = document.querySelector(`input[name="${name}"]:checked`);
    return input ? input.value : '';
  };

  function collectPayload() {
    return {
      language: els.language.value,
      bodyPart: getChecked('bodyPart'),
      situation: getChecked('situation'),
      location: getChecked('location'),
      ulsanDistrict: getChecked('ulsanDistrict'),
      additionalText: els.additionalText.value.trim(),
    };
  }

  /** 서버 응답이 세 카드 문자열을 모두 갖췄는지 확인 */
  function isValidResult(data) {
    return Boolean(data) && COPY_SECTIONS.every(({ key }) => typeof data[key] === 'string' && data[key].trim());
  }

  async function handleAnalyze() {
    if (isSubmitting) return;

    const payload = collectPayload();

    // 필수 항목 확인: 동의 + 아픈 부위 + 발생 상황
    if (!els.consent.checked || !payload.bodyPart || !payload.situation) {
      showToast(MSG.REQUIRED, 'error');
      return;
    }

    // HTTP 헤더에는 ASCII만 넣을 수 있으므로 미리 확인
    const accessCode = getAccessCode();
    if (accessCode && !/^[\x20-\x7E]+$/.test(accessCode)) {
      showError(MSG.ACCESS_CODE_FORMAT);
      showAccessCodeField();
      return;
    }

    setLoading(true);
    hideError();
    hideResults();

    const headers = { 'Content-Type': 'application/json' };
    if (accessCode) headers['x-access-code'] = accessCode;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      // Vercel 자체 오류는 HTML일 수 있으므로 JSON 해석 실패를 허용
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401 && data && data.code === 'ACCESS_CODE_REQUIRED') {
          clearStoredCode();
          showAccessCodeField();
        }
        const fallback = response.status === 504 ? MSG.TIMEOUT : MSG.GENERIC;
        showError((data && typeof data.error === 'string' && data.error) || fallback);
        return;
      }

      if (!isValidResult(data)) {
        showError(MSG.PARSE);
        return;
      }

      storeCode(accessCode); // 성공한 코드만 이번 세션에 보관
      renderResults(data);
    } catch (err) {
      showError(err && err.name === 'AbortError' ? MSG.TIMEOUT : MSG.NETWORK);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  /* ──────────────────────────────────────────────
   * 7. 전체 결과 복사 (navigator.clipboard.writeText만 사용)
   * ────────────────────────────────────────────── */
  function buildCopyText(result) {
    return COPY_SECTIONS.map(({ key, title }) => `${title}\n${result[key]}`).join('\n\n');
  }

  async function handleCopy() {
    if (!lastResult) return;
    try {
      await navigator.clipboard.writeText(buildCopyText(lastResult));
      showToast(MSG.COPY_OK, 'success');
    } catch {
      showToast(MSG.COPY_FAIL, 'error');
    }
  }

  /* ──────────────────────────────────────────────
   * 8. 초기화
   * ────────────────────────────────────────────── */
  function init() {
    renderLanguageOptions();
    renderOptionGroups();
    els.analyzeBtn.addEventListener('click', handleAnalyze);
    els.copyBtn.addEventListener('click', handleCopy);
  }

  init();
})();
