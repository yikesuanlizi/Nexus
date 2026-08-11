// BrowserWorkbench：承载真实 WebContentsView 的浏览器工作台（Phase 2）。
// 不再使用截图数据 URL —— 页面直接以 WebContentsView 呈现，Renderer 只做
// 标签栏/地址栏/导航按钮/容器 bounds 上报（ResizeObserver → setBounds）。
// — English: BrowserWorkbench hosts the real WebContentsView (Phase 2). No more
//   screenshot data URLs — the page renders as a WebContentsView; the renderer
//   only manages tabs/address bar/nav buttons and reports the container bounds.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.js';

// preload typed API 局部结构（electron 目录独立编译边界）。
// — English: local structural shape of the preload typed API.
interface BrowserTabState {
  tabId: string;
  url: string;
  title: string;
  visible: boolean;
  loading: boolean;
  favicon?: string;
}

type BrowserEvent =
  | { type: 'tab-created'; tabId: string; url: string }
  | { type: 'tab-closed'; tabId: string }
  | { type: 'tab-visible'; tabId: string; visible: boolean }
  | { type: 'did-navigate'; tabId: string; url: string }
  | { type: 'page-title'; tabId: string; title: string }
  | { type: 'loading'; tabId: string; loading: boolean };

interface BrowserApi {
  createTab(input: { url: string; bounds: { x: number; y: number; width: number; height: number } }): Promise<BrowserTabState>;
  closeTab(input: { tabId: string }): Promise<void>;
  activateTab(input: { tabId: string }): Promise<void>;
  setBounds(input: { tabId: string; bounds: { x: number; y: number; width: number; height: number } }): Promise<void>;
  navigate(input: { tabId: string; url: string }): Promise<void>;
  back(input: { tabId: string }): Promise<boolean>;
  forward(input: { tabId: string }): Promise<boolean>;
  reload(input: { tabId: string }): Promise<void>;
  stop(input: { tabId: string }): Promise<void>;
  listTabs(): Promise<BrowserTabState[]>;
  subscribe(handler: (event: BrowserEvent) => void): () => void;
}

function getBrowserApi(): BrowserApi | undefined {
  const api = (window as unknown as { nexusDesktop?: { browser?: BrowserApi } }).nexusDesktop?.browser;
  return api ?? undefined;
}

const DEFAULT_URL = 'about:blank';

export function BrowserWorkbench() {
  const apiRef = useRef<BrowserApi | undefined>(undefined);
  const [tabs, setTabs] = useState<BrowserTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 初始化：获取 API、订阅事件、恢复既有标签。
  // — English: init — grab the API, subscribe to events, restore existing tabs.
  useEffect(() => {
    const api = getBrowserApi();
    if (!api) return;
    apiRef.current = api;
    void api.listTabs().then((existing) => {
      setTabs(existing);
      if (existing.length > 0) {
        setActiveTabId(existing[0].tabId);
        setAddress(existing[0].url);
        setLoading(existing[0].loading);
      }
    });
    const unsubscribe = api.subscribe((event) => {
      switch (event.type) {
        case 'tab-created':
          setTabs((prev) => [...prev, { tabId: event.tabId, url: event.url, title: '', visible: true, loading: true }]);
          setActiveTabId(event.tabId);
          setAddress(event.url);
          break;
        case 'tab-closed':
          setTabs((prev) => prev.filter((t) => t.tabId !== event.tabId));
          setActiveTabId((current) => (current === event.tabId ? null : current));
          break;
        case 'did-navigate':
          setTabs((prev) => prev.map((t) => (t.tabId === event.tabId ? { ...t, url: event.url } : t)));
          setActiveTabId((current) => {
            if (current === event.tabId) setAddress(event.url);
            return current;
          });
          break;
        case 'page-title':
          setTabs((prev) => prev.map((t) => (t.tabId === event.tabId ? { ...t, title: event.title } : t)));
          break;
        case 'loading':
          setTabs((prev) => prev.map((t) => (t.tabId === event.tabId ? { ...t, loading: event.loading } : t)));
          setActiveTabId((current) => {
            if (current === event.tabId) setLoading(event.loading);
            return current;
          });
          break;
        default:
          break;
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // 容器尺寸变化 → 上报 bounds（Main 设置 View 布局）。
  // — English: container resize → report bounds (Main lays out the view).
  useEffect(() => {
    const api = apiRef.current;
    const container = containerRef.current;
    if (!api || !container) return;
    const report = (): void => {
      if (!activeTabId) return;
      const rect = container.getBoundingClientRect();
      void api.setBounds({
        tabId: activeTabId,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    };
    const observer = new ResizeObserver(report);
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [activeTabId]);

  const createTab = useCallback(() => {
    const api = apiRef.current;
    const container = containerRef.current;
    if (!api || !container) return;
    const rect = container.getBoundingClientRect();
    void api.createTab({
      url: DEFAULT_URL,
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }, []);

  const submitAddress = useCallback(() => {
    const api = apiRef.current;
    if (!api || !activeTabId) return;
    const url = address.trim();
    if (url === '') return;
    const normalized = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    void api.navigate({ tabId: activeTabId, url: normalized });
  }, [activeTabId, address]);

  const activateTab = useCallback(
    (tabId: string) => {
      const api = apiRef.current;
      if (!api) return;
      setActiveTabId(tabId);
      void api.activateTab({ tabId });
      const tab = tabs.find((t) => t.tabId === tabId);
      setAddress(tab?.url ?? '');
      setLoading(tab?.loading ?? false);
    },
    [tabs],
  );

  const closeTab = useCallback((tabId: string) => {
    const api = apiRef.current;
    if (!api) return;
    void api.closeTab({ tabId });
  }, []);

  const callNav = useCallback(
    (fn: (api: BrowserApi) => Promise<unknown>) => {
      const api = apiRef.current;
      if (!api || !activeTabId) return;
      void fn(api);
    },
    [activeTabId],
  );

  const activeTitle = tabs.find((t) => t.tabId === activeTabId)?.title ?? '';

  return (
    <section className="browserWorkbench" data-testid="browserWorkbench">
      <div className="browserToolbar">
        <button type="button" className="browserToolbarButton" aria-label="后退" onClick={() => callNav((a) => a.back({ tabId: activeTabId! }))} disabled={!activeTabId}>
          <Icon name="chevronLeft" />
        </button>
        <button type="button" className="browserToolbarButton" aria-label="前进" onClick={() => callNav((a) => a.forward({ tabId: activeTabId! }))} disabled={!activeTabId}>
          <Icon name="chevronRight" />
        </button>
        <button type="button" className="browserToolbarButton" aria-label="刷新" onClick={() => callNav((a) => (loading ? a.stop({ tabId: activeTabId! }) : a.reload({ tabId: activeTabId! })))} disabled={!activeTabId}>
          <Icon name={loading ? 'stop' : 'refresh'} />
        </button>
        <input
          className="browserAddress"
          aria-label="地址栏"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitAddress();
          }}
          placeholder="输入网址，Enter 打开"
        />
        <button type="button" className="browserToolbarButton" aria-label="新建标签" onClick={createTab}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="browserTabStrip" role="tablist" data-testid="browserTabStrip">
        {tabs.map((tab) => (
          <button
            key={tab.tabId}
            type="button"
            role="tab"
            aria-selected={tab.tabId === activeTabId}
            className={`browserTab${tab.tabId === activeTabId ? ' active' : ''}`}
            onClick={() => activateTab(tab.tabId)}
          >
            <span className="browserTabTitle">{tab.title || tab.url || '新标签'}</span>
            <span
              className="browserTabClose"
              role="button"
              aria-label="关闭标签"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.tabId);
              }}
            >
              ×
            </span>
          </button>
        ))}
        {tabs.length === 0 ? (
          <button type="button" className="browserTab browserTabEmpty" onClick={createTab}>
            新建标签
          </button>
        ) : null}
      </div>
      <div className="browserViewContainer" ref={containerRef} data-testid="browserViewContainer">
        {activeTitle && tabs.length > 0 ? <span className="browserViewTitleHint">{activeTitle}</span> : null}
      </div>
    </section>
  );
}
