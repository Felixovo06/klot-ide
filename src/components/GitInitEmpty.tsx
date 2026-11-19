// 非 Git 仓库时的空状态引导：线性图标 + 一句说明 + 一键初始化
import { FolderGit2, GitBranchPlus } from 'lucide-react';
import { useGitStore } from '../stores/gitStore';
import { ICON_STROKE } from './ui';

export function GitInitEmpty({ variant = 'canvas' }: { variant?: 'canvas' | 'sidebar' }) {
  const initRepo = useGitStore((s) => s.initRepo);
  const initializing = useGitStore((s) => s.initializing);
  return (
    <div className={`onyx-git-init is-${variant}`}>
      <div className="onyx-git-init-icon">
        <FolderGit2 size={variant === 'canvas' ? 22 : 18} strokeWidth={ICON_STROKE} />
      </div>
      <div className="onyx-git-init-title">当前工作区尚未启用 Git</div>
      <div className="onyx-git-init-sub">初始化后即可在这里审查改动、暂存与提交。</div>
      <button
        type="button"
        className="onyx-primary-btn onyx-git-init-btn"
        disabled={initializing}
        onClick={() => void initRepo()}
      >
        <GitBranchPlus size={14} strokeWidth={ICON_STROKE} />
        {initializing ? '正在初始化...' : '初始化 Git 仓库'}
      </button>
    </div>
  );
}
