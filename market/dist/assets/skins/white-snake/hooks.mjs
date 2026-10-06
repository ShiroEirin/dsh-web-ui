/**
 * white-snake skin hooks (Visual & Theme Edition).
 *
 * 1. Quick Wallpaper Switcher with localStorage persistence.
 * 2. Thematic Badge Card with wallpaper trigger popover.
 * 3. Dynamic contrast veil management for WCAG AAA compliance.
 *
 * Fully compliant with DSH Skin Center pure visual presentation contracts.
 */

export default function defineSkinHooks() {
  return {
    apply(ctx) {
      if (typeof document === 'undefined') return;

      // WS-08：登记所有定时器，确保 dispose 后可取消
      let disposed = false;
      const timers = new Set();
      const backgroundStyles = new Map();
      const backgroundNodes = new Set();
      const later = (fn, ms) => {
        const id = setTimeout(() => {
          timers.delete(id);
          if (!disposed) fn();
        }, ms);
        timers.add(id);
        return id;
      };

      // WS-06：标签页隐藏时暂停皮肤的无限动画与帧循环
      const syncTabHidden = () => {
        document.body.toggleAttribute('data-dsh-tab-hidden', document.hidden);
      };
      document.addEventListener('visibilitychange', syncTabHidden);
      syncTabHidden();

      const WALLPAPER_KEY = 'dsh.theme.white-snake.wallpaper';
      const BACKGROUNDS = [
        { id: "auto", label: "自适应", file: "" },
        { id: "broken-bridge", label: "断桥烟雨 (昼)", file: "broken-bridge.jpg" },
        { id: "snake-destiny", label: "雪岭宿命 (夜)", file: "snake-destiny.jpg" },
      ];

      /**
       * 每张壁纸的实测遮罩强度。由 scripts/calibrate-wallpaper-contrast.mjs 生成：
       * 目标为「典型区域 p50 ≥ 7:1、明亮区域 p90 ≥ 4.5:1」，
       * 面板透明度按最不利的 --dsh-skin-bubble-alpha = 0.35 计算，并含 0.04 安全余量。
       * 修改壁纸资产后必须重新生成本表（CI 门禁会校验）。
       */
      const VEIL_BY_THEME = {
        light: {
          "broken-bridge.jpg": "transparent",
          "snake-destiny.jpg": "rgba(242, 245, 242, 0.20)",
        },
        dark: {
          "broken-bridge.jpg": "transparent",
          "snake-destiny.jpg": "transparent",
        },
      };

      let bgIndex = 0;

      // Restore the persisted wallpaper choice
      try {
        const savedId = localStorage.getItem(WALLPAPER_KEY);
        const idx = BACKGROUNDS.findIndex(b => b.id === savedId);
        if (idx >= 0) bgIndex = idx;
      } catch (_) {}

      // Apply wallpaper: targets skin-center background decoration layer
      const applyWallpaper = (target) => {
        try {
          localStorage.setItem(WALLPAPER_KEY, target.id);
        } catch (_) {}

        const isDark = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
        let fileName = target.file;
        if (!fileName) {
          fileName = isDark ? 'snake-destiny.jpg' : 'broken-bridge.jpg';
        }

        const bgUrl = `${ctx.assetBase}/assets/${fileName}`;

        const updateLayer = () => {
          if (disposed) return;
          const bgLayer = ctx.layers?.background || document.querySelector('[data-dsh-skin-layer="background"]');
          if (bgLayer) {
            if (!backgroundStyles.has(bgLayer)) {
              backgroundStyles.set(bgLayer, bgLayer.style.cssText);
            }
            bgLayer.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:-2;pointer-events:none;overflow:hidden;';

            let imgA = bgLayer.querySelector('.snake-bg-a');
            let imgB = bgLayer.querySelector('.snake-bg-b');
            let scrimOverlay = bgLayer.querySelector('.snake-scrim-overlay');

            if (!imgA) {
              imgA = document.createElement('img');
              backgroundNodes.add(imgA);
              imgA.className = 'snake-bg-a';
              imgA.alt = '';
              imgA.setAttribute('aria-hidden', 'true');
              imgA.style.cssText = 'position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none;transition:opacity 0.6s cubic-bezier(0.4,0,0.2,1);opacity:0;z-index:1;';
              bgLayer.prepend(imgA);
            }
            if (!imgB) {
              imgB = document.createElement('img');
              backgroundNodes.add(imgB);
              imgB.className = 'snake-bg-b';
              imgB.alt = '';
              imgB.setAttribute('aria-hidden', 'true');
              imgB.style.cssText = 'position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none;transition:opacity 0.6s cubic-bezier(0.4,0,0.2,1);opacity:0;z-index:2;';
              bgLayer.insertBefore(imgB, imgA.nextSibling);
            }
            if (!scrimOverlay) {
              scrimOverlay = document.createElement('div');
              backgroundNodes.add(scrimOverlay);
              scrimOverlay.className = 'snake-scrim-overlay';
              scrimOverlay.setAttribute('aria-hidden', 'true');
              scrimOverlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;transition:background 0.4s ease;';
              bgLayer.appendChild(scrimOverlay);
            }

            // 接管 background 层：移除声明式 media
            bgLayer
              .querySelectorAll('img:not(.snake-bg-a):not(.snake-bg-b), div:not(.snake-scrim-overlay)')
              .forEach((node) => node.remove());

            // 双向自适应遮罩：浅色×暗壁纸 与 深色×亮壁纸
            const isDarkNow = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
            scrimOverlay.style.background =
              VEIL_BY_THEME[isDarkNow ? 'dark' : 'light'][fileName] ?? 'transparent';

            // Cross fade between buffer A and buffer B
            const isANow = imgA.style.opacity === '1';
            const incoming = isANow ? imgB : imgA;
            const outgoing = isANow ? imgA : imgB;

            if ((outgoing.src || '').endsWith(fileName) && outgoing.style.opacity === '1') {
              return;
            }

            incoming.src = bgUrl;
            incoming.onload = () => {
              if (disposed) return;
              incoming.style.opacity = '1';
              outgoing.style.opacity = '0';
            };
          }
        };

        updateLayer();
        later(updateLayer, 60);
      };

      applyWallpaper(BACKGROUNDS[bgIndex]);

      const styleTag = document.createElement('style');
      styleTag.id = 'white-snake-styles';
      const s = `html[data-dsh-skin="${ctx.scopeAttr}"]`;
      styleTag.textContent = `
        ${s} .snake-badge-card:focus-visible,
        ${s} .snake-popover-item:focus-visible,
        ${s} .snake-popover-close:focus-visible,
        ${s} .snake-popover-cycle:focus-visible {
          outline: 2px solid #107c65;
          outline-offset: 2px;
        }

        ${s} .snake-footer-container {
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
          box-sizing: border-box;
          font-family: inherit;
          margin-top: auto;
          padding: 6px 0;
        }

        ${s} .snake-badge-card {
          box-sizing: border-box;
          display: flex;
          align-items: center;
          gap: 8px;
          border-radius: 12px;
          padding: 6px 10px;
          cursor: pointer;
          user-select: none;
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, background 0.3s ease, border-color 0.2s ease;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        ${s} .snake-badge-card:hover {
          transform: translateY(-1.5px);
        }
        ${s} .snake-badge-card:active {
          transform: scale(0.98);
        }

        ${s} .snake-badge-emblem {
          width: 24px;
          height: 24px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.3s ease;
        }
        ${s} .snake-badge-card:hover .snake-badge-emblem {
          transform: rotate(-10deg) scale(1.08);
        }

        ${s} .snake-badge-content {
          display: flex;
          flex-direction: column;
          line-height: 1.25;
          min-width: 0;
          flex: 1;
        }
        ${s} .snake-badge-meta-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
        }
        ${s} .snake-badge-title {
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
          flex: 1;
        }

        ${s} .snake-badge-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }

        ${s} .snake-bg-btn {
          font-size: 9.5px;
          height: 20px;
          padding: 0 6px;
          border-radius: 10px;
          font-weight: 600;
          letter-spacing: 0.2px;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.18s ease, transform 0.15s ease, border-color 0.18s ease, color 0.18s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          line-height: 1;
          outline: none;
          border: 1px solid transparent;
          box-sizing: border-box;
          max-width: 78px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        ${s} .snake-bg-btn:hover {
          transform: scale(1.04);
        }

        ${s} .snake-badge-sub {
          font-size: 9.5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0.2px;
          opacity: 0.85;
          margin-top: 2px;
        }

        ${s} .snake-btn-hover {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.15s ease, color 0.15s ease;
          line-height: 1;
          border: none;
          background: transparent;
          box-sizing: border-box;
        }
        ${s} .snake-btn-hover:hover {
          background: rgba(125, 125, 125, 0.2);
          transform: scale(1.12);
        }

        /* Collapsed / Rail sidebar mode adjustments */
        ${s} [data-sidebar-collapsed] .snake-badge-content,
        ${s} [data-sidebar-collapsed] .snake-badge-card,
        

        /* Mini Wallpaper Grid Popover */
        ${s} .snake-wallpaper-popover {
          position: fixed;
          bottom: 96px;
          left: 18px;
          width: 310px;
          max-height: 420px;
          border-radius: 14px;
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
          z-index: 99999;
          display: none;
          flex-direction: column;
          overflow: hidden;
          font-family: inherit;
          box-sizing: border-box;
          animation: snake-pop-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes snake-pop-in {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        ${s} .snake-popover-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 9px 12px 7px 12px;
          border-bottom: 1px solid rgba(125, 125, 125, 0.2);
          font-size: 11.5px;
          font-weight: 700;
        }
        ${s} .snake-popover-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        ${s} .snake-popover-cycle {
          font-size: 10px;
          height: 22px;
          padding: 0 8px;
          border-radius: 11px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          line-height: 1;
          cursor: pointer;
          border: 1px solid transparent;
          outline: none;
          transition: all 0.15s ease;
          box-sizing: border-box;
        }
        ${s} .snake-popover-cycle:hover {
          transform: scale(1.04);
        }
        ${s} .snake-popover-close {
          width: 22px;
          height: 22px;
          border-radius: 11px;
          font-size: 11px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          cursor: pointer;
          border: 1px solid transparent;
          outline: none;
          transition: all 0.15s ease;
          padding: 0;
          box-sizing: border-box;
        }
        ${s} .snake-popover-close:hover {
          transform: scale(1.1);
        }

        ${s} .snake-popover-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 7px;
          padding: 10px;
          overflow-y: auto;
          max-height: 350px;
          box-sizing: border-box;
        }
        ${s} .snake-popover-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          border-radius: 8px;
          padding: 4px;
          cursor: pointer;
          border: 2px solid transparent;
          transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
          user-select: none;
          outline: none;
          box-sizing: border-box;
        }
        ${s} .snake-popover-item:hover {
          transform: scale(1.03);
          background: rgba(125, 125, 125, 0.15);
        }
        ${s} .snake-popover-item.active {
          border-color: #107c65;
          box-shadow: 0 0 8px rgba(16, 124, 101, 0.45);
        }
        ${s} .snake-thumb-img {
          width: 100%;
          height: 64px;
          object-fit: cover;
          border-radius: 6px;
          display: block;
          background: rgba(0, 0, 0, 0.1);
        }
        ${s} .snake-thumb-label {
          font-size: 10px;
          font-weight: 600;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `;
      document.head.appendChild(styleTag);

      // --- Root Container ---
      const container = document.createElement('div');
      container.className = 'snake-footer-container';
      container.setAttribute('data-white-snake-footer-container', 'true');

      // --- Visual Tooltip Bubble ---
      const tipBubble = document.createElement('div');
      tipBubble.className = 'snake-overflow-tooltip';
      tipBubble.setAttribute('role', 'tooltip');
      tipBubble.style.cssText = `
        position: fixed;
        display: none;
        z-index: 999999;
        pointer-events: none;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        line-height: 1.35;
        white-space: nowrap;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        font-family: inherit;
        opacity: 0;
        transition: opacity 0.12s ease;
      `;
      document.body.appendChild(tipBubble);

      const showTooltip = (anchorEl, text) => {
        if (!text || !anchorEl || !anchorEl.isConnected) return;
        tipBubble.textContent = text;
        tipBubble.style.display = 'block';

        const isDark = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
        if (isDark) {
          tipBubble.style.background = 'rgba(16, 26, 29, 0.96)';
          tipBubble.style.border = '1px solid rgba(45, 212, 191, 0.45)';
          tipBubble.style.color = '#ebf5f3';
        } else {
          tipBubble.style.background = 'rgba(242, 246, 242, 0.96)';
          tipBubble.style.border = '1px solid rgba(16, 124, 101, 0.35)';
          tipBubble.style.color = '#161e19';
        }

        const rect = anchorEl.getBoundingClientRect();
        const tipRect = tipBubble.getBoundingClientRect();
        let top = rect.top - tipRect.height - 6;
        if (top < 8) top = rect.bottom + 6;
        let left = rect.left;
        if (left + tipRect.width > window.innerWidth - 8) {
          left = window.innerWidth - tipRect.width - 8;
        }
        if (left < 8) left = 8;

        tipBubble.style.left = `${left}px`;
        tipBubble.style.top = `${top}px`;
        tipBubble.style.opacity = '1';
      };

      const hideTooltip = () => {
        tipBubble.style.opacity = '0';
        tipBubble.style.display = 'none';
      };

      // --- Overflow Tooltip Helper ---
      const tipUpdaters = [];
      const setupOverflowTip = (element, getFullText, fallbackTitle = '') => {
        element.setAttribute('data-has-overflow-tip', 'true');
        const updateTip = (showPopup = false) => {
          if (!element || !element.isConnected) return;
          const isOverflowing = (element.scrollWidth - element.clientWidth) >= 1;
          if (isOverflowing) {
            const full = typeof getFullText === 'function' ? getFullText() : (getFullText || element.textContent || '').trim();
            if (full) {
              element.title = full;
              if (showPopup) showTooltip(element, full);
            }
          } else {
            hideTooltip();
            if (fallbackTitle) {
              element.title = fallbackTitle;
            } else {
              element.removeAttribute('title');
            }
          }
        };

        element.addEventListener('mouseenter', () => updateTip(true));
        element.addEventListener('mouseleave', () => {
          hideTooltip();
          updateTip(false);
        });
        tipUpdaters.push(() => updateTip(false));
        return () => updateTip(false);
      };

      // --- 1. Jade Hairpin Flight Badge (WhiteSnakeBadge) ---
      const badgeCard = document.createElement('div');
      badgeCard.className = 'snake-badge-card';
      badgeCard.setAttribute('data-snake-footer-badge', 'true');
      badgeCard.setAttribute('role', 'group');

      const badgeEmblem = document.createElement('div');
      badgeEmblem.className = 'snake-badge-emblem';
      badgeEmblem.innerHTML = `
        <img src="${ctx.assetBase}/assets/white-snake-emblem.svg" width="22" height="22" alt="白蛇珠钗" style="display:block;filter:drop-shadow(0 1px 3px rgba(16,124,101,0.3));" />
      `;
      badgeCard.appendChild(badgeEmblem);

      const badgeContent = document.createElement('div');
      badgeContent.className = 'snake-badge-content';

      const metaRow = document.createElement('div');
      metaRow.className = 'snake-badge-meta-row';

      const badgeTitle = document.createElement('span');
      badgeTitle.className = 'snake-badge-title';
      badgeTitle.textContent = '白蛇 • 缘起浮生';
      const updateBadgeTitleTip = setupOverflowTip(badgeTitle, () => badgeTitle.textContent);
      metaRow.appendChild(badgeTitle);

      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'snake-badge-actions';

      const themeBtn = document.createElement('button');
      themeBtn.type = 'button';
      themeBtn.className = 'snake-bg-btn';
      themeBtn.title = '切换深色/浅色模式';
      actionsWrap.appendChild(themeBtn);

      const bgBtn = document.createElement('button');
      bgBtn.type = 'button';
      bgBtn.className = 'snake-bg-btn';
      bgBtn.textContent = `🖼️ ${BACKGROUNDS[bgIndex].label}`;
      bgBtn.title = '切换名场面壁纸';
      const updateBgBtnTip = setupOverflowTip(bgBtn, () => bgBtn.textContent, '切换名场面壁纸');
      actionsWrap.appendChild(bgBtn);

      metaRow.appendChild(actionsWrap);
      badgeContent.appendChild(metaRow);

      const badgeSub = document.createElement('span');
      badgeSub.className = 'snake-badge-sub';
      badgeSub.textContent = '断桥相逢 • 宿命相守';
      const updateBadgeSubTip = setupOverflowTip(badgeSub, () => badgeSub.textContent);
      badgeContent.appendChild(badgeSub);

      badgeCard.appendChild(badgeContent);
      container.appendChild(badgeCard);

      // --- 2. Floating Wallpaper Selector Popover ---
      const popover = document.createElement('div');
      popover.className = 'snake-wallpaper-popover';
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-label', '壁纸选择面板');

      const popoverHeader = document.createElement('div');
      popoverHeader.className = 'snake-popover-header';

      const popoverTitle = document.createElement('span');
      popoverTitle.textContent = `❖ 名场面壁纸 (${BACKGROUNDS.length})`;
      popoverHeader.appendChild(popoverTitle);

      const popoverActions = document.createElement('div');
      popoverActions.className = 'snake-popover-actions';

      const popoverCycle = document.createElement('button');
      popoverCycle.type = 'button';
      popoverCycle.className = 'snake-popover-cycle';
      popoverCycle.textContent = '▶ 下一张';
      popoverCycle.title = '轮换下一张壁纸';
      popoverActions.appendChild(popoverCycle);

      const popoverClose = document.createElement('button');
      popoverClose.type = 'button';
      popoverClose.className = 'snake-popover-close';
      popoverClose.textContent = '✕';
      popoverClose.setAttribute('aria-label', '关闭浮层');
      popoverClose.title = '关闭浮层';
      popoverClose.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          popover.style.display = 'none';
        }
      });
      popoverActions.appendChild(popoverClose);

      popoverHeader.appendChild(popoverActions);
      popover.appendChild(popoverHeader);

      const popoverGrid = document.createElement('div');
      popoverGrid.className = 'snake-popover-grid';

      const gridItems = [];
      BACKGROUNDS.forEach((bg, idx) => {
        const item = document.createElement('div');
        item.className = `snake-popover-item ${idx === bgIndex ? 'active' : ''}`;
        item.setAttribute('data-bg-id', bg.id);
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', bg.label);

        const img = document.createElement('img');
        img.className = 'snake-thumb-img';
        img.alt = bg.label;
        if (bg.file) {
          img.src = `${ctx.assetBase}/assets/${bg.file}`;
        } else {
          const isDark = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
          img.src = `${ctx.assetBase}/assets/${isDark ? 'snake-destiny.jpg' : 'broken-bridge.jpg'}`;
        }

        const label = document.createElement('span');
        label.className = 'snake-thumb-label';
        label.textContent = bg.label;

        item.appendChild(img);
        item.appendChild(label);

        const select = () => {
          bgIndex = idx;
          const target = BACKGROUNDS[bgIndex];
          bgBtn.textContent = `🖼️ ${target.label}`;
          updateBgBtnTip();
          applyWallpaper(target);
          updateGridActive();
          popover.style.display = 'none';
        };

        item.addEventListener('click', select);
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select();
          }
        });

        popoverGrid.appendChild(item);
        gridItems.push(item);
      });

      popover.appendChild(popoverGrid);
      document.body.appendChild(popover);

      const updateGridActive = () => {
        gridItems.forEach((it, i) => {
          it.classList.toggle('active', i === bgIndex);
        });
      };

      const togglePopover = (e) => {
        e.stopPropagation();
        if (popover.style.display === 'flex') {
          popover.style.display = 'none';
        } else {
          updateGridActive();
          const rect = bgBtn.getBoundingClientRect();
          popover.style.bottom = `${Math.max(20, window.innerHeight - rect.top + 6)}px`;
          popover.style.left = `${Math.max(12, rect.left - 60)}px`;
          popover.style.display = 'flex';
        }
      };

      bgBtn.addEventListener('click', togglePopover);
      popoverCycle.addEventListener('click', (e) => {
        e.stopPropagation();
        bgIndex = (bgIndex + 1) % BACKGROUNDS.length;
        const target = BACKGROUNDS[bgIndex];
        bgBtn.textContent = `🖼️ ${target.label}`;
        updateBgBtnTip();
        applyWallpaper(target);
        updateGridActive();
      });
      popoverClose.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.style.display = 'none';
      });

      const handleClickOutside = (e) => {
        if (popover.style.display === 'flex' && !popover.contains(e.target) && !bgBtn.contains(e.target)) {
          popover.style.display = 'none';
        }
      };
      document.addEventListener('click', handleClickOutside);
      const handleKeyDown = (e) => {
        if (e.key === 'Escape' && popover.style.display === 'flex') {
          popover.style.display = 'none';
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      // --- 4. Theme & Cards Synchronizer ---
      const applyCardTheme = () => {
        const isDark = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
        themeBtn.textContent = isDark ? '🌙 夜' : '☀️ 昼';
        themeBtn.title = isDark ? '当前为永州雪夜，点击切为西湖日间' : '当前为西湖日间，点击切为永州暗夜';

        if (isDark) {
          badgeCard.style.background = 'rgba(16, 26, 29, 0.90)';
          badgeCard.style.border = '1px solid rgba(45, 212, 191, 0.28)';
          badgeCard.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.50)';
          badgeTitle.style.color = '#ebf5f3';
          badgeSub.style.color = '#9db2ad';
          themeBtn.style.background = 'rgba(45, 212, 191, 0.18)';
          themeBtn.style.border = '1px solid rgba(45, 212, 191, 0.38)';
          themeBtn.style.color = '#2dd4bf';
          bgBtn.style.background = 'rgba(45, 212, 191, 0.18)';
          bgBtn.style.border = '1px solid rgba(45, 212, 191, 0.38)';
          bgBtn.style.color = '#2dd4bf';

          
          

          popover.style.background = 'rgba(14, 22, 25, 0.94)';
          popover.style.border = '1px solid rgba(45, 212, 191, 0.25)';
          popover.style.color = '#ebf5f3';
          popoverCycle.style.background = 'rgba(45, 212, 191, 0.18)';
          popoverCycle.style.border = '1px solid rgba(45, 212, 191, 0.38)';
          popoverCycle.style.color = '#2dd4bf';
          popoverClose.style.background = 'rgba(45, 212, 191, 0.18)';
          popoverClose.style.border = '1px solid rgba(45, 212, 191, 0.38)';
          popoverClose.style.color = '#2dd4bf';
        } else {
          badgeCard.style.background = 'rgba(235, 240, 235, 0.90)';
          badgeCard.style.border = '1px solid rgba(16, 124, 101, 0.22)';
          badgeCard.style.boxShadow = '0 4px 16px rgba(16, 30, 25, 0.10)';
          badgeTitle.style.color = '#161e19';
          badgeSub.style.color = '#48594f';
          themeBtn.style.background = 'rgba(16, 124, 101, 0.14)';
          themeBtn.style.border = '1px solid rgba(16, 124, 101, 0.28)';
          themeBtn.style.color = '#107c65';
          bgBtn.style.background = 'rgba(16, 124, 101, 0.14)';
          bgBtn.style.border = '1px solid rgba(16, 124, 101, 0.28)';
          bgBtn.style.color = '#107c65';

          
          

          popover.style.background = 'rgba(242, 246, 242, 0.94)';
          popover.style.border = '1px solid rgba(16, 124, 101, 0.20)';
          popover.style.color = '#161e19';
          popoverCycle.style.background = 'rgba(16, 124, 101, 0.14)';
          popoverCycle.style.border = '1px solid rgba(16, 124, 101, 0.28)';
          popoverCycle.style.color = '#107c65';
          popoverClose.style.background = 'rgba(16, 124, 101, 0.14)';
          popoverClose.style.border = '1px solid rgba(16, 124, 101, 0.28)';
          popoverClose.style.color = '#107c65';
        }
      };

      const applyTheme = () => {
        applyCardTheme();
        later(() => {
          applyWallpaper(BACKGROUNDS[bgIndex]);
        }, 30);
      };

      const unsubTheme = ctx.theme.subscribe(applyTheme);

      themeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isDark = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
        const nextScheme = isDark ? 'light' : 'dark';

        document.body.toggleAttribute('data-ds-dark-theme', nextScheme === 'dark');
        applyTheme();

        try {
          await fetch('/api/settings/mutate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'client-request',
              rpcId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
              method: 'settings/mutate',
              payload: {
                args: {
                  ns: 'ui-theme',
                  ops: [{ op: 'set', path: ['preference'], value: nextScheme }]
                }
              }
            })
          });
        } catch (_) {}
      });

      // --- 6. Mount Container into Sidebar Footer ---
      let mounted = false;
      const mountIntoSidebar = () => {
        if (disposed || typeof document === 'undefined') return false;
        if (mounted) return true;
        const footer = document.querySelector('div:has(> [data-slot="sidebar.footer.action"])');
        if (footer && footer.parentElement) {
          footer.parentElement.insertBefore(container, footer);
          container.style.position = 'static';
          tipUpdaters.forEach((fn) => fn());
          mounted = true;
          return true;
        }

        const slot = document.querySelector('[data-slot="sidebar.footer.action"]');
        if (slot) {
          slot.appendChild(container);
          container.style.position = 'static';
          tipUpdaters.forEach((fn) => fn());
          mounted = true;
          return true;
        }

        const sidebar = document.querySelector('[data-slot="sidebar"], div:has(> [data-slot="sidebar"])');
        if (sidebar) {
          sidebar.appendChild(container);
          container.style.position = 'relative';
          container.style.margin = '6px 10px';
          tipUpdaters.forEach((fn) => fn());
          mounted = true;
          return true;
        }
        return false;
      };

      let observer = null;
      if (!mountIntoSidebar()) {
        document.body.appendChild(container);
        if (typeof MutationObserver !== 'undefined') {
          observer = new MutationObserver(() => {
            if (mountIntoSidebar()) {
              if (observer) {
                observer.disconnect();
                observer = null;
              }
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }
      }

      // Cleanup
      ctx.onCleanup(() => {
        disposed = true;
        timers.forEach((id) => clearTimeout(id));
        timers.clear();

        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', syncTabHidden);
          document.body.removeAttribute('data-dsh-tab-hidden');
          document.removeEventListener('click', handleClickOutside);
          document.removeEventListener('keydown', handleKeyDown);
        }

        unsubTheme();
        if (observer) {
          observer.disconnect();
          observer = null;
        }

        for (const node of backgroundNodes) node.remove();
        backgroundNodes.clear();
        for (const [bgLayer, cssText] of backgroundStyles) {
          bgLayer.style.cssText = cssText;
        }
        backgroundStyles.clear();

        if (popover.parentNode) popover.parentNode.removeChild(popover);
        if (tipBubble.parentNode) tipBubble.parentNode.removeChild(tipBubble);
        if (container.parentNode) container.parentNode.removeChild(container);
        if (styleTag.parentNode) styleTag.parentNode.removeChild(styleTag);
      });
    },
  };
}
