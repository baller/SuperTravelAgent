import {
  BellRinging,
  CalendarDots,
  CaretDoubleLeft,
  CaretDoubleRight,
  GearSix,
  House,
  List,
  MapTrifold,
  UserCircle,
  X,
} from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { BrandMark } from './Doodles';
import type { Readiness, TripDetail, UserProfile } from '../types';

export type AppPage = 'home' | 'workspace' | 'today' | 'decisions' | 'settings';

const pageCopy: Record<AppPage, { title: string; eyebrow: string }> = {
  home: { title: '旅程首页', eyebrow: '你的旅行管家' },
  workspace: { title: '行程工作台', eyebrow: '对话、时间与地图保持一致' },
  today: { title: '今日行程', eyebrow: '只看现在与下一步' },
  decisions: { title: '待决定', eyebrow: '只处理真正需要你选择的事情' },
  settings: { title: '设置', eyebrow: '账户、偏好与服务诊断' },
};

export function AppFrame({
  page,
  trip,
  profile,
  readiness,
  pendingCount,
  collapsed,
  onCollapsedChange,
  onNavigate,
  children,
}: {
  page: AppPage;
  trip: TripDetail | null;
  profile: UserProfile | null;
  readiness: Readiness | null;
  pendingCount: number;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onNavigate: (page: AppPage) => void;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = (target: AppPage) => {
    setMobileOpen(false);
    onNavigate(target);
  };
  const displayName = profile?.display_name || '本地旅行者';
  const initial = displayName.trim().slice(0, 1) || '旅';
  const copy = pageCopy[page];
  const navItems: Array<{ page: AppPage; label: string; icon: typeof House; disabled?: boolean; badge?: number }> = [
    { page: 'home', label: '首页', icon: House },
    { page: 'decisions', label: '待决定', icon: BellRinging, badge: pendingCount },
    { page: 'workspace', label: '当前行程', icon: MapTrifold, disabled: !trip },
    { page: 'today', label: '今天', icon: CalendarDots, disabled: !trip?.current_plan },
  ];
  return (
    <div className="app-shell" data-sidebar={collapsed ? 'collapsed' : 'expanded'} data-mobile-nav={mobileOpen ? 'open' : 'closed'}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className="app-sidebar" aria-label="应用导航">
        <header>
          <button type="button" className="sidebar-brand" onClick={() => navigate('home')} aria-label="返回 SuperTravel 首页">
            <BrandMark className="brand-mark" />
            <span><strong>SuperTravel</strong><small>旅行一直有人照看</small></span>
          </button>
          <button type="button" className="mobile-nav-close" onClick={() => setMobileOpen(false)} aria-label="关闭导航"><X size={20} /></button>
        </header>
        <nav aria-label="主要功能">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.page} type="button" className={page === item.page ? 'is-active' : ''} onClick={() => navigate(item.page)} disabled={item.disabled} aria-current={page === item.page ? 'page' : undefined} title={collapsed ? item.label : undefined}>
                <Icon size={21} weight={page === item.page ? 'fill' : 'regular'} />
                <span>{item.label}</span>
                {Boolean(item.badge) && <em>{item.badge}</em>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <button type="button" className={page === 'settings' ? 'is-active' : ''} onClick={() => navigate('settings')} aria-current={page === 'settings' ? 'page' : undefined} title={collapsed ? '设置' : undefined}>
            <GearSix size={21} weight={page === 'settings' ? 'fill' : 'regular'} /><span>设置</span>
          </button>
          <button type="button" className="sidebar-profile" onClick={() => navigate('settings')} title={collapsed ? displayName : undefined}>
            <b>{initial}</b><span><strong>{displayName}</strong><small>本地账户</small></span>
          </button>
          <button type="button" className="sidebar-collapse" onClick={() => onCollapsedChange(!collapsed)} aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}>
            {collapsed ? <CaretDoubleRight size={17} /> : <CaretDoubleLeft size={17} />}<span>{collapsed ? '' : '收起导航'}</span>
          </button>
        </div>
      </aside>
      {mobileOpen && <button type="button" className="nav-scrim" onClick={() => setMobileOpen(false)} aria-label="关闭导航" />}
      <div className="app-main-shell">
        <header className="app-topbar">
          <button type="button" className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="打开导航"><List size={22} /></button>
          <div className="topbar-context"><small>{copy.eyebrow}</small><strong>{page === 'workspace' && trip ? trip.title : copy.title}</strong></div>
          <div className="topbar-actions">
            {!readiness?.ready && <button type="button" className="service-warning" onClick={() => navigate('settings')}>服务需配置</button>}
            <button type="button" className="topbar-icon-button" onClick={() => navigate('decisions')} aria-label={`待决定事项 ${pendingCount} 项`}>
              <BellRinging size={20} />{pendingCount > 0 && <em>{pendingCount}</em>}
            </button>
            <details className="user-menu">
              <summary aria-label="打开用户中心"><b>{initial}</b><span>{displayName}</span></summary>
              <div>
                <header><b>{initial}</b><span><strong>{displayName}</strong><small>当前为单用户本地模式</small></span></header>
                <button type="button" onClick={() => navigate('settings')}><UserCircle size={18} />个人资料与偏好</button>
                <button type="button" onClick={() => navigate('settings')}><GearSix size={18} />设置与服务诊断</button>
              </div>
            </details>
          </div>
        </header>
        {children}
        <nav className="mobile-bottom-nav" aria-label="移动端导航">
          {navItems.slice(0, 4).map((item) => {
            const Icon = item.icon;
            return <button key={item.page} type="button" className={page === item.page ? 'is-active' : ''} onClick={() => navigate(item.page)} disabled={item.disabled}><Icon size={21} weight={page === item.page ? 'fill' : 'regular'} /><span>{item.label}</span>{Boolean(item.badge) && <em>{item.badge}</em>}</button>;
          })}
        </nav>
      </div>
    </div>
  );
}
