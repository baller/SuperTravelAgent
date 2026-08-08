import { CheckCircle, Database, GearSix, IdentificationCard, Trash, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Readiness, UserPreferenceData, UserProfile } from '../types';

type SettingsSection = 'profile' | 'preferences' | 'services';

const preferenceNames: Record<string, string> = {
  pace: '旅行节奏', walking: '步行强度', wake_up: '起床时间', diet: '饮食习惯', interests: '长期兴趣', transport: '交通偏好', daily_density: '每日行程密度',
};

function preferenceValue(value: Record<string, unknown>) {
  const values = Object.values(value).flatMap((item) => Array.isArray(item) ? item : [item]).filter((item) => ['string', 'number', 'boolean'].includes(typeof item));
  return values.length ? values.map(String).join('、') : '已保存的结构化偏好';
}

export function SettingsPage({ readiness, profile, showWorkProcess, onShowWorkProcessChange, onUpdateProfile, onDeletePreference }: {
  readiness: Readiness | null;
  profile: UserProfile | null;
  showWorkProcess: boolean;
  onShowWorkProcessChange: (enabled: boolean) => void;
  onUpdateProfile: (displayName: string) => Promise<void>;
  onDeletePreference: (preferenceId: string) => Promise<void>;
}) {
  const [section, setSection] = useState<SettingsSection>('profile');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<UserPreferenceData>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleteTarget) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [deleteTarget]);
  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const displayName = String(data.get('display_name') || '').trim();
    if (!displayName) return;
    setSaving(true); setSaved(false); setActionError('');
    void onUpdateProfile(displayName)
      .then(() => setSaved(true))
      .catch((reason: Error) => setActionError(reason.message || '无法保存个人资料'))
      .finally(() => setSaving(false));
  };
  return (
    <main id="main-content" className="standalone-page settings-page">
      <header><span>设置</span><h1>账户、偏好与服务</h1><p>这里只放用户可以理解或控制的内容；底层服务状态集中在诊断页，不再占用首页。</p></header>
      <div className="settings-layout">
        <nav aria-label="设置分类">
          <button type="button" className={section === 'profile' ? 'is-active' : ''} onClick={() => setSection('profile')}><IdentificationCard size={19} />个人资料</button>
          <button type="button" className={section === 'preferences' ? 'is-active' : ''} onClick={() => setSection('preferences')}><GearSix size={19} />旅行偏好</button>
          <button type="button" className={section === 'services' ? 'is-active' : ''} onClick={() => setSection('services')}><Database size={19} />服务与数据</button>
        </nav>
        <section className="settings-content">
          {actionError && <p className="settings-action-error" role="alert">{actionError}</p>}
          {section === 'profile' && <>
            <header><h2>个人资料</h2><p>当前 MVP 为单用户本地模式，没有登录、社交资料或云端账号。</p></header>
            <form className="profile-form" onSubmit={submitProfile} key={profile?.display_name}>
              <label htmlFor="profile-name">显示名称</label><input id="profile-name" name="display_name" defaultValue={profile?.display_name || '本地旅行者'} maxLength={120} />
              <button type="submit" className="button-primary" disabled={saving}>{saving ? '正在保存' : '保存资料'}</button>{saved && <span><CheckCircle size={17} />已保存</span>}
            </form>
            <div className="setting-row"><div><strong>展示管家工作过程</strong><p>在对话中展示正在解决的问题、真实工具调用、结果与可点击来源。隐藏推理、提示词和底层请求不会出现在页面中。</p></div><label className="settings-switch"><input type="checkbox" checked={showWorkProcess} onChange={(event) => onShowWorkProcessChange(event.target.checked)} /><span aria-hidden="true"><i /></span><em>{showWorkProcess ? '开启' : '关闭'}</em></label></div>
          </>}
          {section === 'preferences' && <>
            <header><h2>旅行偏好</h2><p>这里只保存你明确确认过、能跨旅程复用的偏好。临时疲劳、单次预算和模型推断不会出现在这里。</p></header>
            <div className="preference-list">
              {profile?.preferences.map((item) => <article key={item.id}><div><strong>{preferenceNames[item.key] || item.key}</strong><p>{preferenceValue(item.value)}</p><small>{item.evidence_count} 条确认依据 · {new Date(item.updated_at).toLocaleDateString('zh-CN')}</small></div><button type="button" onClick={() => setDeleteTarget(item)} aria-label={`删除偏好 ${preferenceNames[item.key] || item.key}`}><Trash size={18} /></button></article>)}
              {!profile?.preferences.length && <div className="settings-empty">还没有长期偏好。旅行结束或你明确提出稳定习惯后，管家会先询问是否保存。</div>}
            </div>
          </>}
          {section === 'services' && <>
            <header><h2>服务与数据</h2><p>面向开发和故障排查的状态集中在这里。正常情况下，用户不需要关注这些信息。</p></header>
            <div className="service-diagnostics">
              {readiness?.services.map((service) => <article key={service.name}>{service.ready ? <CheckCircle size={20} weight="fill" /> : <WarningCircle size={20} />}<div><strong>{service.name}</strong><p>{service.detail}</p></div><span>{service.required ? '核心服务' : '可选服务'}</span></article>)}
            </div>
            <div className="data-note"><Database size={22} /><div><strong>数据保存在本机 Docker 数据卷</strong><p>Trip State、对话、版本、来源和 Watch 存入 PostgreSQL；任务队列与短期工具缓存存入 Redis。当前 Agent 主链路不使用 RAG。API 密钥只从根目录 <code>.env</code> 读取，不通过浏览器显示或修改。</p></div></div>
          </>}
        </section>
      </div>
      <dialog ref={dialogRef} className="confirm-dialog" onCancel={() => setDeleteTarget(undefined)} aria-labelledby="delete-preference-title">
        <div><WarningCircle size={25} /><h2 id="delete-preference-title">删除这条长期偏好？</h2><p>删除后，未来行程不会再自动使用“{deleteTarget ? preferenceNames[deleteTarget.key] || deleteTarget.key : ''}”。历史 Trip 不受影响。</p><footer><button type="button" onClick={() => setDeleteTarget(undefined)}>取消</button><button type="button" className="danger-button" onClick={() => { if (!deleteTarget) return; setActionError(''); void onDeletePreference(deleteTarget.id).then(() => setDeleteTarget(undefined)).catch((reason: Error) => { setDeleteTarget(undefined); setActionError(reason.message || '无法删除旅行偏好'); }); }}>确认删除</button></footer></div>
      </dialog>
    </main>
  );
}
