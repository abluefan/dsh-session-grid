// dsh-session-grid client half（PoC v5）
//
// 目標：一個 main 頁面入面，用 n 個 pane 同時渲染 n 條「獨立 session」嘅對話。
//
// v5 改動（2026-10-23）：
//   · 移除頂部標題 bar
//   · 左側加常駐會話列表（揀位用），唔再只靠 sidebar hover 按鈕
//   · 窗格橫向單行排列（唔換行），超出寬度就橫向滾動
//   · 強制滾到最底：mount 後逐步重試 + 子樹內所有可滾容器一併滾
//
// 用咗嘅官方擴展點（零改 DSH 源碼）：
//   1. slots.register 掛新 main 頁（key: session-grid）
//   2. 該頁宣告 child slot 'sessiongrid.pane'（scope: session）
//      → 因為宣告咗 session child，GridPage props 自動收到 SessionProvider
//   3. 每格：sessions.retain(sessionId) + <SessionProvider> 包住 renderSlot
//      ★ provider 必須喺 renderSlot「外面」，否則 slot 冇 session scope ⇒ 空白
//   4. renderFactorySlot('conversation.content', {variant:'embedded'})
//   5. sidebar.workspaces.session.row.action 加按鈕
//   6. ctx.layout.selectPanel 切換頁面
//
// 格式：tsdown 產出的 lazy-CJS 約定 —— window.__ModuleLoader__ 殼。
window.__ModuleLoader__.load({
  id: 'dsh-session-grid',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'session-grid'
    const PANE_SLOT = 'sessiongrid.pane'
    const STORAGE_KEY = 'dsh-session-grid.panes'

    // ── pane 清單 store（跨 slot 共享 + 持久化）─────────────────────────────
    let paneIds = readStored()
    const listeners = new Set()
    let selectGridPanel = null

    /**
     * 由 localStorage 讀返清單。
     * @returns {string[]} session id 陣列
     */
    function readStored() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter(item => typeof item === 'string' && item !== '')
      } catch (ignored) {
        return []
      }
    }

    /**
     * 寫返 localStorage。
     * @param {string[]} ids - 要存嘅 session id
     * @returns {void}
     */
    function persist(ids) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
      } catch (ignored) {
        // 寫唔到就只保留記憶體狀態
      }
    }

    /**
     * 更新清單並通知所有訂閱者。
     * @param {string[]} ids - 新清單
     * @returns {void}
     */
    function commit(ids) {
      paneIds = ids
      persist(ids)
      listeners.forEach(listener => {
        try { listener() } catch (ignored) { /* 單一訂閱者出錯唔影響其他 */ }
      })
    }

    /**
     * 加一格（已存在就唔重複）。
     * @param {string} id - session id
     * @returns {void}
     */
    function addPane(id) {
      if (paneIds.indexOf(id) !== -1) return
      commit(paneIds.concat([id]))
    }

    /**
     * 關一格。
     * @param {string} id - session id
     * @returns {void}
     */
    function removePane(id) {
      commit(paneIds.filter(item => item !== id))
    }

    /**
     * 拖動重排：將 fromId 移到 toId 嘅位置。
     * @param {string} fromId - 被拖嘅 session id
     * @param {string} toId - 目標位置嘅 session id
     * @returns {void}
     */
    function movePane(fromId, toId) {
      if (fromId === toId) return
      const from = paneIds.indexOf(fromId)
      const to = paneIds.indexOf(toId)
      if (from === -1 || to === -1) return
      const next = paneIds.slice()
      next.splice(from, 1)
      next.splice(to, 0, fromId)
      commit(next)
    }

    /**
     * 喺最左邊加一格（新會話用）。
     * @param {string} id - session id
     * @returns {void}
     */
    function prependPane(id) {
      if (paneIds.indexOf(id) !== -1) return
      commit([id].concat(paneIds))
    }

    /**
     * 清理累積嘅空白格。
     *
     * 背景：新會話捕獲會將每個新 blank session 加格，但 DSH 每次開殼都可能
     * 建一個 blank session ⇒ 格數越積越多，全部係未命名空白格。
     *
     * 規則：
     *   · 有內容（blank !== true）嘅格 → 一律保留
     *   · 空白格 → 只保留最左嗰一個（最新加入嗰個），其餘移除
     *   · 對唔到 snapshot 嘅（session 已刪）→ 移除
     * @param {object} sessionsService - client sessions service
     * @returns {void}
     */
    function pruneBlankPanes(sessionsService) {
      if (sessionsService === undefined) return
      const snapshot = sessionsService.list.getSnapshot()
      // ★ 必須等 ready：mount 初期 byId 係空，否則會將所有 id 當成
      //   「session 唔存在」而清空成個網格（2026-10-25 實際踩過）。
      if (snapshot.phase !== 'ready') return
      const byId = snapshot.byId || {}
      const kept = []
      let keptOneBlank = false
      for (const id of paneIds) {
        const row = byId[id]
        if (row === undefined) continue
        if (row.blank === true) {
          if (keptOneBlank) continue
          keptOneBlank = true
        }
        kept.push(id)
      }
      if (kept.length !== paneIds.length) commit(kept)
    }

    /**
     * 訂閱清單變化。
     * @param {Function} listener - 變化時呼叫
     * @returns {Function} 取消訂閱
     */
    function subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }

    // ── 樣式 ───────────────────────────────────────────────────────────────
    const STYLE_ID = 'dsh-session-grid-style'
    const CSS = [
      '.sg-root{display:flex;height:100%;min-height:0;width:100%}',
      // 右側格區（橫向單行，唔換行）
      '.sg-main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column}',
      '.sg-grid{display:flex;flex-direction:row;flex:1 1 auto;min-height:0;overflow-x:auto;overflow-y:hidden}',
      '.sg-cell{flex:1 1 0;min-width:260px;min-height:0;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--dsw-alias-border-l1,#ddd)}',
      '.sg-cell:last-child{border-right:0}',
      '.sg-cell-head{display:flex;gap:6px;align-items:center;padding:0 6px;height:22px;box-sizing:border-box;background:var(--dsw-alias-bg-l2,#f5f5f5);font-size:12px;flex:0 0 auto}',
      '.sg-cell-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:22px}',
      '.sg-cell-grip{cursor:grab;user-select:none;opacity:.5;padding:0 2px;font-size:12px;line-height:22px}',
      '.sg-cell-grip:active{cursor:grabbing}',
      '.sg-cell-dragging{opacity:.45}',
      // 關閉鍵：闊度大（好撳），但高度屈從 header 厚度（22px），唔會再撐高條 title。
      '.sg-cell-close{display:inline-flex;align-items:center;justify-content:center;width:30px;height:20px;padding:0;border:0;border-radius:5px;background:transparent;color:inherit;font-size:18px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s ease;margin-right:-4px}',
      '.sg-cell:hover .sg-cell-close{opacity:.4}',
      '.sg-cell-close:hover{opacity:1;background:var(--dsw-alias-bg-l3,#e3e3e3)}',
      // 原生對話靠 .body{flex:1;min-height:0} + .scrollBody{overflow-y:auto}
      // + .composerSeat{position:sticky} 三件套。所以呢度一定要做 flex
      // 容器兼 overflow:hidden，先可以令 .body 撐滿、scrollBody 自己滾、
      // composer 自己 sticky。少咗 display:flex 就會高度塌、完全滾唔到。
      // position:relative 係必要嘅：原生 TurnNavigator 用 absolute 定位
      // 喺 scrollport 右側，冇定位祖先就會跳出格仔或者被裁走。
      '.sg-cell-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;position:relative}',
      '.sg-cell-body > *{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
      '.sg-btn{font-size:12px;padding:1px 6px;cursor:pointer}',
      '.sg-empty{padding:16px;opacity:.6;line-height:1.7}',
      '.sg-hint{padding:8px 12px;font-size:12px;opacity:.7}',
      '.sg-row-add{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:0;background:transparent;cursor:pointer;font-size:13px;line-height:1;opacity:.75}',
      '.sg-row-add:hover{opacity:1}',
    ].join('\n')

    /**
     * 確保樣式表已注入（重複呼叫安全）。
     * @returns {void}
     */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = CSS
      document.head.appendChild(el)
    }

    // ── Factory local view ─────────────────────────────────────────────────
    /**
     * conversation.content 的 views 位置：固定渲染該 session 的 chat 檢視。
     * @param props - factory local props（含 renderSlot）
     * @returns {React.ReactNode} chat 檢視
     */
    function FixedChatConversationView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }))
    }

    // ── 格子本體 ───────────────────────────────────────────────────────────
    /**
     * 渲染一格嘅對話內容。
     * @param props - slot props（scope: session，含 renderFactorySlot / sessionId）
     * @returns {React.ReactNode} 該 session 嘅嵌入式對話
     */
    function GridPane(props) {
      const { renderFactorySlot } = props
      if (typeof renderFactorySlot !== 'function') {
        return h('div', { className: 'sg-hint' }, 'renderFactorySlot 不可用')
      }
      return renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: 'active', hero: false },
        { slots: { views: FixedChatConversationView } },
      )
    }

    // ── 單格容器 ───────────────────────────────────────────────────────────
    /**
     * 一個格：retain 一條 session，用 SessionProvider 包住 slot 派發。
     * @param props - id / title / renderSlot / sessions / SessionProvider / onClose
     * @returns {React.ReactNode} 一格
     */
    function PaneCell(props) {
      const { id, title, renderSlot, sessions, SessionProvider, onClose, onMove } = props
      const [reference, setReference] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const [dragging, setDragging] = React.useState(false)
      const bodyRef = React.useRef(null)

      React.useEffect(() => {
        if (sessions === undefined) {
          setFailure('sessions 服務不可用')
          return undefined
        }
        let held
        try {
          held = sessions.retain(id, { source: 'sessionGrid' })
        } catch (error) {
          setFailure(String(error && error.message ? error.message : error))
          return undefined
        }
        setReference(held)
        return () => {
          try { held.release() } catch (ignored) { /* 已釋放 */ }
        }
      }, [id, sessions])

      // 強制滾到最底：mount 後逐步重試（等內容/字型/layout 落定），
      // 之後由 MutationObserver 接手。子樹內所有可滾容器一併滾，
      // 因為 DSH 對話自己有一層內層 scrollport。
      React.useEffect(() => {
        const el = bodyRef.current
        if (el === null) return undefined

        // force=true 只喺初次用；之後一律「貼近底部才跟」，
        // 否則用戶 scroll 上去睇舊訊息會不斷被扯返落嚟。
        const scrollAll = (force) => {
          const nodes = [el].concat(Array.from(el.querySelectorAll('*')))
          for (const node of nodes) {
            if (node.scrollHeight <= node.clientHeight + 4) continue
            const gap = node.scrollHeight - node.scrollTop - node.clientHeight
            if (force || gap < 160) node.scrollTop = node.scrollHeight
          }
        }

        // 初次強制到底（等打開就一定見到最新）
        window.setTimeout(() => scrollAll(true), 0)
        // 之後幾次重試只喺仍然貼底時才跟（應付慢載入）
        const timers = [80, 200, 420, 800, 1400].map(ms => window.setTimeout(() => scrollAll(false), ms))

        const observer = new MutationObserver(() => {
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => scrollAll(false))
          else scrollAll(false)
        })
        observer.observe(el, { childList: true, subtree: true, characterData: true })

        return () => {
          timers.forEach(t => window.clearTimeout(t))
          observer.disconnect()
        }
      }, [reference])

      let body
      if (failure !== null) body = h('div', { className: 'sg-hint' }, failure)
      else if (reference === null) body = h('div', { className: 'sg-hint' }, '載入中…')
      else if (typeof SessionProvider !== 'function') body = h('div', { className: 'sg-hint' }, 'SessionProvider 不可用')
      else {
        body = h(SessionProvider, { session: reference },
          renderSlot(PANE_SLOT, { sessionId: id }),
        )
      }

      return h('div', {
        className: 'sg-cell' + (dragging ? ' sg-cell-dragging' : ''),
        'data-sg-cell': id,
        onDragOver: (e) => { e.preventDefault() },
        onDrop: (e) => {
          e.preventDefault()
          setDragging(false)
          const fromId = e.dataTransfer.getData('text/plain')
          if (fromId !== '' && typeof onMove === 'function') onMove(fromId, id)
        },
      },
        h('div', { className: 'sg-cell-head' },
          h('span', {
            className: 'sg-cell-grip',
            draggable: true,
            title: '拖動改變位置',
            onDragStart: (e) => {
              e.dataTransfer.setData('text/plain', id)
              e.dataTransfer.effectAllowed = 'move'
              setDragging(true)
            },
            onDragEnd: () => { setDragging(false) },
          }, '⠿'),
          h('span', { className: 'sg-cell-title' }, title),
          h('button', { className: 'sg-cell-close', title: '關閉', onClick: () => onClose(id) }, '×'),
        ),
        h('div', { className: 'sg-cell-body', ref: bodyRef }, body),
      )
    }

    // ── 頁面 ───────────────────────────────────────────────────────────────
    /**
     * 會話網格頁：左邊揀位列表，右邊橫向排列嘅格。
     * @param props - slot props：renderSlot / SessionProvider / sessions（inject 傳入）
     * @returns {React.ReactNode} 網格頁面
     */
    function GridPage(props) {
      const { renderSlot, SessionProvider, sessions } = props
      const [chosen, setChosen] = React.useState(() => paneIds.slice())
      const [, forceRender] = React.useState(0)

      React.useEffect(() => { ensureStyle() }, [])
      React.useEffect(() => subscribe(() => setChosen(paneIds.slice())), [])

      // 每次入網格頁都清一次殘留：session 已經刪／移走嘅 id 唔應該繼續佔格。
      // （apply 時只跑一次；DSH 唔重啟嘅話 paneIds 會殘留舊 id。）
      React.useEffect(() => {
        pruneBlankPanes(sessions)
      }, [sessions])

      const list = sessions === undefined ? undefined : sessions.list

      React.useEffect(() => {
        if (list === undefined) return undefined
        return list.subscribe(() => { forceRender(n => n + 1) })
      }, [list])

      const snapshot = list === undefined ? { ids: [], byId: {} } : list.getSnapshot()

      const titleOf = (id) => {
        const row = snapshot.byId && snapshot.byId[id]
        if (row === undefined || row === null) return id
        if (typeof row.title === 'string' && row.title !== '') return row.title
        return id
      }

      // 已刪除嘅 session 暫時唔顯示（唔主動清走，返嚟就見返）
      const visible = chosen.filter(id => snapshot.byId !== undefined && snapshot.byId[id] !== undefined)

      const cells = visible.map(id =>
        h(PaneCell, {
          key: id,
          id,
          title: titleOf(id),
          renderSlot,
          sessions,
          SessionProvider,
          onClose: removePane,
          onMove: movePane,
        }),
      )

      const main = visible.length === 0
        ? h('div', { className: 'sg-empty' },
            '喺左邊「工作區」列表將滑鼠移到任何一條會話，撳「⊞」就會喺呢度開一格。',
          )
        : h('div', { className: 'sg-grid' }, cells)

      return h('div', { className: 'sg-root' },
        h('div', { className: 'sg-main' }, main),
      )
    }

    // ── 側邊欄入口 icon ────────────────────────────────────────────────────
    /**
     * 側邊欄 panellist 圖示。
     * @returns {React.ReactNode} 圖示
     */
    function GridIcon() {
      return h('span', { title: '會話網格' }, '▦')
    }

    // ── 每行會話嘅「加入網格」按鈕 ─────────────────────────────────────────
    /**
     * sidebar session row 的 action：加入／移出網格。
     * @param props - owner props：sessionId / displayTitle
     * @returns {React.ReactNode} 一個細 icon 按鈕
     */
    function AddToGridButton(props) {
      const { sessionId } = props
      const [inGrid, setInGrid] = React.useState(() => paneIds.indexOf(sessionId) !== -1)

      React.useEffect(() => subscribe(() => {
        setInGrid(paneIds.indexOf(sessionId) !== -1)
      }), [sessionId])

      const toggle = (event) => {
        event.stopPropagation()
        if (paneIds.indexOf(sessionId) === -1) {
          addPane(sessionId)
          if (typeof selectGridPanel === 'function') {
            try { selectGridPanel() } catch (ignored) { /* 切唔到頁面唔影響加入 */ }
          }
        } else {
          removePane(sessionId)
        }
      }

      return h('button', {
        className: 'sg-row-add',
        title: inGrid ? '移出會話網格' : '加入會話網格',
        onClick: toggle,
      }, inGrid ? '▦' : '⊞')
    }

    const inject = ['slots', 'sessions']

    /**
     * 插件入口。
     * @param ctx - client cordis context
     * @returns {void}
     */
    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const sessions = ctx.get('sessions')
      const layout = ctx.get('layout')
      if (layout !== undefined && typeof layout.selectPanel === 'function') {
        selectGridPanel = () => { layout.selectPanel(PANEL_ID) }
      }

      ensureStyle()

      const mount = (parent, factory, label) => {
        try {
          slots.inject(parent, factory)
        } catch (error) {
          console.error('dsh-session-grid: ' + label + ' mount 失敗', error)
        }
      }

      mount('main', () => slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ sessions }),
        children: { [PANE_SLOT]: { kind: 'single', scope: 'session' } },
      }, GridPage), 'main page')

      mount(PANE_SLOT, () => slots.register({
        name: PANE_SLOT,
      }, GridPane), 'pane')

      mount('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        label: () => '會話網格',
      }, GridIcon), 'panellist icon')

      mount('sidebar.workspaces.session.row.action', () => slots.register({
        name: 'sidebar.workspaces.session.row.action',
        id: 'session-grid-add',
        order: 300,
      }, AddToGridButton), 'row action')

      // 清理累積嘅空白格（等 sessions 載入 ready 之後做一次）。
      if (sessions !== undefined) {
        ctx.effect(() => {
          let done = false
          const tryPrune = () => {
            if (done) return
            const snapshot = sessions.list.getSnapshot()
            if (snapshot.phase !== 'ready') return
            done = true
            pruneBlankPanes(sessions)
          }
          const off = sessions.list.subscribe(tryPrune)
          tryPrune()
          return () => { off() }
        }, 'dsh-session-grid: prune blank panes')
      }

      // 自動開頁：插件啟用時，如果已經有格，就直接切去會話網格。
      // panel 註冊同 Loader 掛載有先後，所以用重試（最多 20 次 × 100ms）。
      if (layout !== undefined && typeof layout.selectPanel === 'function' && paneIds.length > 0) {
        let tries = 0
        const attempt = () => {
          try {
            layout.selectPanel(PANEL_ID)
          } catch (error) {
            tries += 1
            if (tries < 20) window.setTimeout(attempt, 100)
          }
        }
        window.setTimeout(attempt, 150)
      }

      // ── 拖放附件：保持原生行為（已知限制）───────────────
      // ui-attachment 喺 document（冒泡階段）為每個 composer 掛 drop listener，
      // 而且冇判斷 drop 落喺邊 → 多格時全部收貨。
      // 插件側無法完美繞過（shell.addFiles 冇 service 暴露），
      // 2026-10-23 決定暫時接受這個限制。
      // ── 新會話落喺網格最左（2026-10-24）────────────────────────────────
      // 需求：喺會話網格頁按「新會話」（Ctrl+Alt+N / 左邊欄按鈕）時，
      // 要喺網格最左開一格，而唔係跳去原生單頁。
      //
      // 原生 startSession() 會建立 session 然後切去 conversation（main = null），
      // 所以冇得直接攔。改為：
      //   ① 記住「網格頁最近一次 active 嘅時間」
      //   ② 監聽 sessions.list，見到新增而且係 blank 嘅 session
      //   ③ 如果 321 秒內網格頁曾經 active，就當係「由網格開新會話」
      //      → prependPane（最左）＋ 切返網格頁
      // 新 session 由原生 startSession 建立，所以默認權限 / preset / 工作區全部照原生。
      // ⚠ 321 秒係寬鬆窗口（刻意取寬）：寧願偶爾誤接，唔好漏接。
      if (layout !== undefined && layout.panelInfo !== undefined && sessions !== undefined) {
        let lastGridAt = 0
        // ★ 必須用 null 起步：plugin 載入時 sessions.list 仲係 pending（ids 空），
        // 如果即刻用空集合做 baseline，載入完成時全部 session 都會被當成「新增」，
        // 一次過將幾十條塞入網格。改為「第一次見到 ready 只記錄 baseline，唔加格」。
        let knownIds = null

        const onPanel = () => {
          const info = layout.panelInfo.getSnapshot()
          if (info !== null && info !== undefined && info.activePanelId === PANEL_ID) {
            lastGridAt = Date.now()
          }
        }
        const onList = () => {
          const snapshot = sessions.list.getSnapshot()
          if (snapshot.phase !== 'ready') return
          const ids = snapshot.ids || []
          if (knownIds === null) {
            knownIds = new Set(ids)
            return
          }
          const added = ids.filter(id => !knownIds.has(id))
          knownIds = new Set(ids)
          if (added.length === 0) return
          if (Date.now() - lastGridAt > 321000) return
          let touched = false
          for (const id of added) {
            const row = snapshot.byId !== undefined ? snapshot.byId[id] : undefined
            if (row === undefined || row.blank !== true) continue
            prependPane(id)
            touched = true
          }
          if (touched) {
            // 加完即刻清一次：prependPane 加喺最左（最新），prune 保留最左嗰個
            // blank ⇒ 永遠最多一個空白格，唔會隨開新會話累積。
            pruneBlankPanes(sessions)
            try {
              layout.selectPanel(PANEL_ID)
            } catch (ignored) {
              // 切唔到頁面唔影響已經加入嘅格
            }
          }
        }

        ctx.effect(() => {
          const offPanel = layout.panelInfo.subscribe(onPanel)
          const offList = sessions.list.subscribe(onList)
          onPanel()
          // 心跳：panelInfo 只在「值變化」時通知。如果用戶一直留喺網格頁，
          // lastGridAt 就唔會再更新 → 停留超過窗口就漏接。
          // 所以每 2 秒確認一次：仍然係網格頁就 refresh 時間。
          const heartbeat = window.setInterval(() => {
            const info = layout.panelInfo.getSnapshot()
            if (info !== null && info !== undefined && info.activePanelId === PANEL_ID) {
              lastGridAt = Date.now()
            }
          }, 2000)
          return () => {
            window.clearInterval(heartbeat)
            offPanel()
            offList()
          }
        }, 'dsh-session-grid: new-session capture')
      }

      console.log('dsh-session-grid ready (PoC v8)')
    }

    exports.name = 'dsh-session-grid'
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
