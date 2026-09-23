import type { ReactElement } from 'react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import { useAuth } from '@/hooks/useAuth';
import { useMyPeakAuth } from '@/hooks/useMyPeakAuth';
import { useIntervalsConnection } from '@/hooks/useIntervalsConnection';
import { usePortConfig } from '@/hooks/usePortConfig';
import { useTrainingPeaksEnvironment } from '@/hooks/useTrainingPeaksEnvironment';
import { usePlanMyPeakEnvironment } from '@/hooks/usePlanMyPeakEnvironment';
import { clearAuth as clearMyPeakAuth } from '@/services/myPeakAuthService';
import type {
  PlanMyPeakEnvironment,
  TrainingPeaksEnvironment,
} from '@/utils/constants';
import { useProviderAuthRefresh } from '@/hooks/useProviderAuthRefresh';
import {
  formatTokenAge,
  buildProviderStatusLabel,
  SETTINGS_STRINGS,
  AUTH_STATUS_STRINGS,
} from '@/utils/uiStrings';
import {
  DEFAULT_PLANMYPEAK_APP_PORT,
  DEFAULT_PLANMYPEAK_SUPABASE_PORT,
  PLANMYPEAK_ENVIRONMENTS,
  parsePort,
} from '@/utils/constants';
import { IntervalsApiKeyBanner } from './IntervalsApiKeyBanner';
import { AuthRow } from './shared/AuthRow';
import { ErrorBoundary } from './ErrorBoundary';
import {
  IntegrationHelpModal,
  type IntegrationHelpTopic,
} from './IntegrationHelpModal';
import { DebugLogPanel } from './DebugLogPanel';

interface SettingsPageProps {
  isPlanMyPeakEnabled: boolean;
  isIntervalsEnabled: boolean;
  onPlanMyPeakEnabledChange: (enabled: boolean) => Promise<void>;
  onIntervalsEnabledChange: (enabled: boolean) => Promise<void>;
  openLogs?: boolean;
}

interface OptionalConnectionCardProps {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onOpenHelp: () => void;
  children?: ReactElement;
}

function OptionalConnectionCard({
  title,
  description,
  enabled,
  onToggle,
  onOpenHelp,
  children,
}: OptionalConnectionCardProps): ReactElement {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-800">{title}</p>
            <button
              type="button"
              onClick={onOpenHelp}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[11px] font-semibold text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700"
              aria-label={`Open ${title} import guide`}
              title={`Open ${title} import guide`}
            >
              ?
            </button>
          </div>
          <p className="text-xs text-gray-600">{description}</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              void onToggle(event.target.checked);
            }}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>
            {enabled ? SETTINGS_STRINGS.ENABLED : SETTINGS_STRINGS.DISABLED}
          </span>
        </label>
      </div>
      {enabled ? (
        <div className="mt-3">{children}</div>
      ) : (
        <p className="mt-3 text-xs text-gray-500">
          {SETTINGS_STRINGS.CONNECTION_DISABLED}
        </p>
      )}
    </div>
  );
}

function SettingsPageContent({
  isPlanMyPeakEnabled,
  isIntervalsEnabled,
  onPlanMyPeakEnabledChange,
  onIntervalsEnabledChange,
  openLogs = false,
}: SettingsPageProps): ReactElement {
  const [activeHelpTopic, setActiveHelpTopic] =
    useState<IntegrationHelpTopic | null>(null);
  const [pendingAppPort, setPendingAppPort] = useState<string | null>(null);
  const [pendingSupabasePort, setPendingSupabasePort] = useState<string | null>(
    null
  );
  const [isSaving, setIsSaving] = useState(false);

  const {
    isAuthenticated: isTpAuthenticated,
    isLoading: isTpLoading,
    error: tpError,
    tokenAge: tpTokenAge,
    refreshAuth: refreshTpAuth,
  } = useAuth();
  const { data: user } = useUser({ enabled: isTpAuthenticated });

  const {
    isAuthenticated: isMyPeakAuthenticated,
    isLoading: isMyPeakLoading,
    error: myPeakError,
    tokenAge: myPeakTokenAge,
    refreshAuth: refreshMyPeakAuth,
    validateAuth: validateMyPeakAuth,
  } = useMyPeakAuth();

  const {
    isAuthenticated: isIntervalsAuthenticated,
    isLoading: isIntervalsLoading,
    error: intervalsError,
    refresh: refreshIntervals,
  } = useIntervalsConnection();

  const {
    isConfigurable: isPortConfigurable,
    appPort,
    supabasePort,
    setAppPort,
    setSupabasePort,
  } = usePortConfig();

  const queryClient = useQueryClient();
  const {
    environment: tpEnvironment,
    setEnvironment: setTpEnvironment,
    isLoading: isTpEnvironmentLoading,
  } = useTrainingPeaksEnvironment();

  const {
    environment: planMyPeakEnvironment,
    availableEnvironments: planMyPeakEnvironments,
    hostLabel: planMyPeakHostLabel,
    isLocalEnvironment: isPlanMyPeakLocalEnvironment,
    isLoading: isPlanMyPeakEnvironmentLoading,
    setEnvironment: setPlanMyPeakEnvironment,
  } = usePlanMyPeakEnvironment();

  const handlePlanMyPeakEnvironmentChange = async (
    next: PlanMyPeakEnvironment
  ): Promise<void> => {
    if (next === planMyPeakEnvironment) return;
    await setPlanMyPeakEnvironment(next);
    // The captured token belongs to the deployment it was captured on, and the
    // cached data to the previous environment's API — drop both so the popup
    // asks for a fresh sign-in on the newly selected one.
    await clearMyPeakAuth();
    await queryClient.invalidateQueries();
    await refreshMyPeakAuth();
  };

  const handleTrainingPeaksEnvironmentChange = async (
    next: TrainingPeaksEnvironment
  ): Promise<void> => {
    if (next === tpEnvironment) return;
    await setTpEnvironment(next);
    // The stored token and cached data belong to the previous environment;
    // refetch everything against the newly selected TrainingPeaks API.
    await queryClient.invalidateQueries();
    await refreshTpAuth();
  };

  // Track pending vs saved port values
  const appPortDisplay = pendingAppPort ?? String(appPort);
  const supabasePortDisplay = pendingSupabasePort ?? String(supabasePort);

  // Check if there are unsaved changes
  const hasUnsavedPortChanges =
    pendingAppPort !== null || pendingSupabasePort !== null;

  // Any TCP port is accepted; local-target builds match loopback hosts without
  // a port in the manifest, so no rebuild is needed to move the dev app.
  const parsedAppPort = parsePort(appPortDisplay);
  const parsedSupabasePort = parsePort(supabasePortDisplay);

  const canSavePorts =
    hasUnsavedPortChanges &&
    parsedAppPort !== null &&
    parsedSupabasePort !== null;

  const handleSavePorts = async (): Promise<void> => {
    // Re-checked field by field rather than via canSavePorts so the parsed
    // ports narrow to numbers here.
    if (
      !hasUnsavedPortChanges ||
      parsedAppPort === null ||
      parsedSupabasePort === null
    ) {
      return;
    }

    setIsSaving(true);
    try {
      await setAppPort(parsedAppPort);
      await setSupabasePort(parsedSupabasePort);

      // Clear pending state after successful save
      setPendingAppPort(null);
      setPendingSupabasePort(null);
    } finally {
      setIsSaving(false);
    }
  };

  const tpAuthRefresh = useProviderAuthRefresh('trainingpeaks');
  const myPeakAuthRefresh = useProviderAuthRefresh('planmypeak');

  const handleTrainingPeaksRefresh = async (): Promise<void> => {
    await tpAuthRefresh.refresh();
    await refreshTpAuth();
  };

  const handleMyPeakRefresh = async (): Promise<void> => {
    await myPeakAuthRefresh.refresh();
    await refreshMyPeakAuth();
    await validateMyPeakAuth();
  };

  // Build status labels using centralized string functions
  const userName = user
    ? `${user.firstName} ${user.lastName}`.trim()
    : undefined;
  const tpLabel = buildProviderStatusLabel(
    'TrainingPeaks',
    isTpLoading,
    isTpAuthenticated,
    tpError,
    userName
  );

  const tpSubtitle = isTpAuthenticated
    ? `${AUTH_STATUS_STRINGS.TOKEN_AGE_PREFIX} ${formatTokenAge(tpTokenAge)}`
    : `${AUTH_STATUS_STRINGS.TRAINING_PEAKS.REQUIRED_PREFIX}${AUTH_STATUS_STRINGS.TRAINING_PEAKS.OPEN_TO_CAPTURE}.`;

  const myPeakLabel = buildProviderStatusLabel(
    'PlanMyPeak',
    isMyPeakLoading,
    isMyPeakAuthenticated,
    myPeakError
  );

  const myPeakSubtitle = isMyPeakAuthenticated
    ? `${AUTH_STATUS_STRINGS.TOKEN_AGE_PREFIX} ${formatTokenAge(myPeakTokenAge)}`
    : `${AUTH_STATUS_STRINGS.PLANMYPEAK.openToSignIn(planMyPeakHostLabel)}.`;

  const intervalsLabel = buildProviderStatusLabel(
    'Intervals.icu',
    isIntervalsLoading,
    isIntervalsAuthenticated,
    intervalsError
  );

  const intervalsSubtitle = isIntervalsAuthenticated
    ? AUTH_STATUS_STRINGS.API_KEY_CONFIGURED
    : AUTH_STATUS_STRINGS.INTERVALS.ADD_API_KEY;

  return (
    <div className="space-y-3">
      <IntegrationHelpModal
        topic={activeHelpTopic}
        onClose={() => {
          setActiveHelpTopic(null);
        }}
      />

      <div>
        <h2 className="text-sm font-semibold text-gray-800">
          {SETTINGS_STRINGS.TITLE}
        </h2>
        <p className="text-xs text-gray-600">{SETTINGS_STRINGS.SUBTITLE}</p>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <p className="text-xs font-semibold text-blue-900">
          {SETTINGS_STRINGS.TRAINING_PEAKS_REQUIRED}
        </p>
        <p className="mb-2 text-xs text-blue-800">
          {SETTINGS_STRINGS.TRAINING_PEAKS_DESCRIPTION}
        </p>
        <AuthRow
          label={tpLabel}
          subtitle={tpSubtitle}
          isAuthenticated={isTpAuthenticated}
          isLoading={isTpLoading}
          error={tpError}
          onRefresh={handleTrainingPeaksRefresh}
        />
        {tpAuthRefresh.message ? (
          <p className="mt-1 text-xs text-gray-600" role="status">
            {tpAuthRefresh.message}
          </p>
        ) : null}

        <div className="mt-3 border-t border-blue-200 pt-2">
          <p className="mb-1 text-xs font-medium text-blue-900">Environment</p>
          <div className="flex gap-2">
            {(['production', 'sandbox'] as const).map((env) => (
              <label
                key={env}
                className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                  tpEnvironment === env
                    ? 'border-blue-400 bg-blue-100 font-medium text-blue-900'
                    : 'border-blue-200 bg-white text-blue-800'
                } ${isTpEnvironmentLoading ? 'opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="trainingpeaks-environment"
                  value={env}
                  checked={tpEnvironment === env}
                  disabled={isTpEnvironmentLoading}
                  onChange={() => {
                    void handleTrainingPeaksEnvironmentChange(env);
                  }}
                  className="h-3 w-3"
                />
                {env === 'production' ? 'Production' : 'Sandbox'}
              </label>
            ))}
          </div>
          {tpEnvironment === 'sandbox' && (
            <p className="mt-1.5 text-[10px] text-blue-700">
              Using app.sandbox.trainingpeaks.com — sign in there to capture a
              sandbox token.
            </p>
          )}
        </div>
      </div>

      <OptionalConnectionCard
        title={SETTINGS_STRINGS.PLANMYPEAK_OPTIONAL}
        description={SETTINGS_STRINGS.PLANMYPEAK_DESCRIPTION}
        enabled={isPlanMyPeakEnabled}
        onToggle={onPlanMyPeakEnabledChange}
        onOpenHelp={() => {
          setActiveHelpTopic('planmypeak');
        }}
      >
        <div className="space-y-2">
          <AuthRow
            label={myPeakLabel}
            subtitle={myPeakSubtitle}
            isAuthenticated={isMyPeakAuthenticated}
            isLoading={isMyPeakLoading}
            error={myPeakError}
            onRefresh={handleMyPeakRefresh}
          />
          {myPeakAuthRefresh.message ? (
            <p className="mt-1 text-xs text-gray-600" role="status">
              {myPeakAuthRefresh.message}
            </p>
          ) : null}
          <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
            <p className="mb-1 text-xs font-medium text-gray-700">
              Environment
            </p>
            <div className="flex gap-2">
              {planMyPeakEnvironments.map((env) => (
                <label
                  key={env}
                  className={`flex flex-1 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
                    planMyPeakEnvironment === env
                      ? 'border-blue-400 bg-blue-50 font-medium text-blue-900'
                      : 'border-gray-200 bg-white text-gray-700'
                  } ${isPlanMyPeakEnvironmentLoading ? 'opacity-60' : ''}`}
                >
                  <input
                    type="radio"
                    name="planmypeak-environment"
                    value={env}
                    checked={planMyPeakEnvironment === env}
                    disabled={isPlanMyPeakEnvironmentLoading}
                    onChange={() => {
                      void handlePlanMyPeakEnvironmentChange(env);
                    }}
                    className="h-3 w-3"
                  />
                  {PLANMYPEAK_ENVIRONMENTS[env].label}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-gray-600">
              Using {planMyPeakHostLabel}. Switching clears the captured
              PlanMyPeak sign-in — open the new environment and sign in there.
            </p>
          </div>
          {isPortConfigurable && isPlanMyPeakLocalEnvironment && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
              <div className="mb-1.5 text-xs font-medium text-amber-800">
                Local Dev Ports
              </div>
              <p className="mb-2 text-[10px] text-amber-700">
                Point local builds at whichever ports your dev app and Supabase
                are on. Defaults are{' '}
                {`${DEFAULT_PLANMYPEAK_APP_PORT}/${DEFAULT_PLANMYPEAK_SUPABASE_PORT}`}
                .
              </p>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label
                    htmlFor="app-port"
                    className="mb-0.5 block text-[10px] text-amber-700"
                  >
                    App Port
                  </label>
                  <input
                    id="app-port"
                    type="text"
                    inputMode="numeric"
                    value={appPortDisplay}
                    onChange={(e) => setPendingAppPort(e.target.value)}
                    aria-invalid={parsedAppPort === null}
                    className={`w-full rounded border bg-white px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 ${
                      parsedAppPort === null
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                        : 'border-amber-300 focus:border-amber-500 focus:ring-amber-500'
                    }`}
                  />
                </div>
                <div className="flex-1">
                  <label
                    htmlFor="supabase-port"
                    className="mb-0.5 block text-[10px] text-amber-700"
                  >
                    Supabase Port
                  </label>
                  <input
                    id="supabase-port"
                    type="text"
                    inputMode="numeric"
                    value={supabasePortDisplay}
                    onChange={(e) => setPendingSupabasePort(e.target.value)}
                    aria-invalid={parsedSupabasePort === null}
                    className={`w-full rounded border bg-white px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 ${
                      parsedSupabasePort === null
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                        : 'border-amber-300 focus:border-amber-500 focus:ring-amber-500'
                    }`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSavePorts()}
                  disabled={!canSavePorts || isSaving}
                  className="shrink-0 rounded border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
              {(parsedAppPort === null || parsedSupabasePort === null) && (
                <p className="mt-1 text-[10px] text-red-600">
                  Enter a port number between 1 and 65535.
                </p>
              )}
            </div>
          )}
        </div>
      </OptionalConnectionCard>

      <OptionalConnectionCard
        title={SETTINGS_STRINGS.INTERVALS_OPTIONAL}
        description={SETTINGS_STRINGS.INTERVALS_DESCRIPTION}
        enabled={isIntervalsEnabled}
        onToggle={onIntervalsEnabledChange}
        onOpenHelp={() => {
          setActiveHelpTopic('intervalsicu');
        }}
      >
        <div className="space-y-2">
          <AuthRow
            label={intervalsLabel}
            subtitle={intervalsSubtitle}
            isAuthenticated={isIntervalsAuthenticated}
            isLoading={isIntervalsLoading}
            error={intervalsError}
            onRefresh={refreshIntervals}
          />
          <IntervalsApiKeyBanner />
        </div>
      </OptionalConnectionCard>

      <DebugLogPanel initialExpanded={openLogs} />
    </div>
  );
}

/**
 * SettingsPage component wrapped with ErrorBoundary
 *
 * Provides error handling for the settings page to prevent crashes
 * from affecting the entire extension popup.
 */
export function SettingsPage(props: SettingsPageProps): ReactElement {
  return (
    <ErrorBoundary>
      <SettingsPageContent {...props} />
    </ErrorBoundary>
  );
}
