import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { vscode } from '../vscodeApi.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

type ProviderId = 'claude' | 'copilot';

interface BottomToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
  enabledProviders?: ProviderId[];
  defaultProvider?: ProviderId;
}

export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
  enabledProviders = ['claude', 'copilot'],
  defaultProvider = 'claude',
}: BottomToolbarProps) {
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const [isProviderMenuOpen, setIsProviderMenuOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);
  const pendingProviderRef = useRef<ProviderId>(defaultProvider);

  // Close folder picker / bypass menu / provider menu on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isBypassMenuOpen && !isProviderMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
        setIsBypassMenuOpen(false);
        setIsProviderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFolderPickerOpen, isBypassMenuOpen, isProviderMenuOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;
  const hasMultipleProviders = enabledProviders.length > 1;

  const launchAgent = (provider: ProviderId, folderPath?: string, bypassPermissions?: boolean) => {
    const messageType = provider === 'copilot' ? 'openCopilot' : 'openClaude';
    vscode.postMessage({ type: messageType, folderPath, bypassPermissions });
  };

  const handleAgentClick = () => {
    setIsBypassMenuOpen(false);
    setIsProviderMenuOpen(false);
    pendingBypassRef.current = false;
    pendingProviderRef.current = defaultProvider;

    if (hasMultipleProviders) {
      // Show provider selection first
      setIsProviderMenuOpen((v) => !v);
    } else if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      // Single provider, single folder — just launch
      launchAgent(enabledProviders[0] ?? 'claude');
    }
  };

  const handleAgentHover = () => {
    if (!isFolderPickerOpen && !isProviderMenuOpen) {
      setIsBypassMenuOpen(true);
    }
  };

  const handleAgentLeave = () => {
    if (!isFolderPickerOpen && !isProviderMenuOpen) {
      setIsBypassMenuOpen(false);
    }
  };

  const handleProviderSelect = (provider: ProviderId) => {
    pendingProviderRef.current = provider;
    setIsProviderMenuOpen(false);

    if (hasMultipleFolders) {
      setIsFolderPickerOpen(true);
    } else {
      launchAgent(provider, undefined, pendingBypassRef.current);
      pendingBypassRef.current = false;
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const bypassPermissions = pendingBypassRef.current;
    const provider = pendingProviderRef.current;
    pendingBypassRef.current = false;
    pendingProviderRef.current = defaultProvider;
    launchAgent(provider, folder.path, bypassPermissions);
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = bypassPermissions;

    if (hasMultipleProviders) {
      setIsProviderMenuOpen(true);
    } else if (hasMultipleFolders) {
      setIsFolderPickerOpen(true);
    } else {
      launchAgent(enabledProviders[0] ?? 'claude', undefined, bypassPermissions);
      pendingBypassRef.current = false;
    }
  };

  const getProviderLabel = (provider: ProviderId): string => {
    switch (provider) {
      case 'claude':
        return 'Claude Code';
      case 'copilot':
        return 'Copilot CLI';
      default:
        return provider;
    }
  };

  return (
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 pixel-panel p-4">
      <div
        ref={folderPickerRef}
        className="relative"
        onMouseEnter={handleAgentHover}
        onMouseLeave={handleAgentLeave}
      >
        <Button
          variant="accent"
          onClick={handleAgentClick}
          className={
            isFolderPickerOpen || isBypassMenuOpen || isProviderMenuOpen
              ? 'bg-accent-bright'
              : 'bg-accent hover:bg-accent-bright'
          }
        >
          + Agent
        </Button>
        <Dropdown isOpen={isBypassMenuOpen}>
          <DropdownItem onClick={() => handleBypassSelect(true)}>
            Skip permissions mode <span className="text-2xs text-warning">⚠</span>
          </DropdownItem>
        </Dropdown>
        <Dropdown isOpen={isProviderMenuOpen}>
          {enabledProviders.map((provider) => (
            <DropdownItem key={provider} onClick={() => handleProviderSelect(provider)}>
              {getProviderLabel(provider)}
            </DropdownItem>
          ))}
        </Dropdown>
        <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
          {workspaceFolders.map((folder) => (
            <DropdownItem
              key={folder.path}
              onClick={() => handleFolderSelect(folder)}
              className="text-base"
            >
              {folder.name}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
      <Button
        variant={isEditMode ? 'active' : 'default'}
        onClick={onToggleEditMode}
        title="Edit office layout"
      >
        Layout
      </Button>
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        title="Settings"
      >
        Settings
      </Button>
    </div>
  );
}
