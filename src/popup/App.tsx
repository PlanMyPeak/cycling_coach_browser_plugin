import type { ReactElement } from 'react';
import { useState } from 'react';
import { ArrowLeft as BackIcon, Settings as SettingsIcon } from 'lucide-react';
import { LibraryList } from './components/LibraryList';
import { LibraryDetails } from './components/LibraryDetails';
import { TabNavigation } from './components/TabNavigation';
import type { TabType } from './components/TabNavigation';
import { TrainingPlanList } from './components/TrainingPlanList';
import { AthleteGroupList } from './components/AthleteGroupList';
import { CapturedWorkoutList } from './components/CapturedWorkoutList';
import { PlanCalendar } from './components/PlanCalendar';
import { SettingsPage } from './components/SettingsPage';
import { ConnectionHealthSummary } from './components/ConnectionHealthSummary';
import { PlanMyPeakEnvironmentIndicator } from './components/PlanMyPeakEnvironmentIndicator';
import { ExportProgressBanner } from './components/ExportProgressBanner';
import { ApiErrorNotification } from './components/ApiErrorNotification';
import { AccountMismatchBanner } from './components/AccountMismatchBanner';
import { useAuth } from '@/hooks/useAuth';
import { useMyPeakAuth } from '@/hooks/useMyPeakAuth';
import { useIntervalsConnection } from '@/hooks/useIntervalsConnection';
import { useConnectionSettings } from '@/hooks/useConnectionSettings';
import { useLibraries } from '@/hooks/useLibraries';
import { usePlanMyPeakEnvironment } from '@/hooks/usePlanMyPeakEnvironment';
import { useCapturedWorkouts } from '@/hooks/useCapturedWorkouts';
import { useProviderAuthRefresh } from '@/hooks/useProviderAuthRefresh';
import { useDebugLogs } from '@/hooks/useDebugLogs';

function App(): ReactElement {
  const [activeView, setActiveView] = useState<'main' | 'settings'>('main');
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | null>(
    null
  );
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('libraries');
  const [openLogs, setOpenLogs] = useState(false);
  const [popupOpenedAt] = useState(() => Date.now());
  const { logs } = useDebugLogs();
  const {
    isAuthenticated: isTrainingPeaksAuthenticated,
    isLoading: isTrainingPeaksAuthLoading,
    refreshAuth: refreshTrainingPeaksAuth,
  } = useAuth();
  const { isAuthenticated: isPlanMyPeakAuthenticated } = useMyPeakAuth();
  const { isAuthenticated: isIntervalsAuthenticated } =
    useIntervalsConnection();
  const {
    isPlanMyPeakEnabled,
    isIntervalsEnabled,
    setPlanMyPeakEnabled,
    setIntervalsEnabled,
  } = useConnectionSettings();
  const { environment: planMyPeakEnvironment, hostLabel: planMyPeakHostLabel } =
    usePlanMyPeakEnvironment();
  const { pendingCount: pendingCapturedCount } = useCapturedWorkouts();
  const tpAuthRefresh = useProviderAuthRefresh('trainingpeaks');
  const canAccessTrainingPeaksData = isTrainingPeaksAuthenticated;
  const recentErrorCutoff = popupOpenedAt - 15 * 60 * 1000;
  const latestFailedLog =
    logs.find((log) => !log.success && log.timestamp >= recentErrorCutoff) ??
    null;

  // TrainingPeaks data should be visible as soon as TP authentication is ready.
  const { data: libraries } = useLibraries({
    enabled: canAccessTrainingPeaksData,
  });

  // Find the selected library name
  const selectedLibrary = libraries?.find(
    (lib) => lib.exerciseLibraryId === selectedLibraryId
  );
  const selectedLibraryName = selectedLibrary?.libraryName ?? '';

  const handleBackToLibraries = (): void => {
    setSelectedLibraryId(null);
  };

  const handleBackToPlans = (): void => {
    setSelectedPlanId(null);
  };

  const handleTabChange = (tab: TabType): void => {
    setActiveTab(tab);
    // Reset selections when switching tabs
    setSelectedLibraryId(null);
    setSelectedPlanId(null);
  };

  const handleSelectPlan = (planId: number): void => {
    setSelectedPlanId(planId);
  };

  const handleRefreshTrainingPeaks = async (): Promise<void> => {
    // The background answers once the token has landed (or tells us the
    // coach must sign in), so no timer is needed here.
    await tpAuthRefresh.refresh();
    await refreshTrainingPeaksAuth();
  };

  const handleOpenLogs = (): void => {
    setOpenLogs(true);
    setActiveView('settings');
  };

  const handleSettingsToggle = (): void => {
    if (activeView === 'settings') {
      setOpenLogs(false);
      setActiveView('main');
    } else {
      setActiveView('settings');
    }
  };

  // Use wider layout for calendar view
  const isCalendarView =
    activeView === 'main' && activeTab === 'plans' && selectedPlanId !== null;
  const containerWidth = isCalendarView ? 'w-[750px]' : 'w-[580px]';

  return (
    <div className={`${containerWidth} min-h-96 p-4 bg-gray-50`}>
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src={chrome.runtime.getURL('icons/icon128.png')}
            alt="PlanMyPeak Importer logo"
            className="h-9 w-9 shrink-0 rounded-md"
          />
          <div>
            <h1 className="text-lg font-bold text-gray-800">
              PlanMyPeak Importer
            </h1>
            <p className="text-xs text-gray-600">Workout Library Access</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSettingsToggle}
          aria-label={activeView === 'main' ? 'Open settings' : 'Back to main'}
          title={activeView === 'main' ? 'Settings' : 'Back'}
          className="rounded p-1.5 text-gray-700 hover:bg-gray-100"
        >
          {activeView === 'main' ? (
            <SettingsIcon className="h-7 w-7" aria-hidden="true" />
          ) : (
            <BackIcon className="h-7 w-7" aria-hidden="true" />
          )}
        </button>
      </div>

      <PlanMyPeakEnvironmentIndicator
        environment={planMyPeakEnvironment}
        hostLabel={planMyPeakHostLabel}
      />

      <ApiErrorNotification
        error={latestFailedLog}
        onViewLogs={handleOpenLogs}
      />

      <ExportProgressBanner />

      {activeView === 'settings' ? (
        <SettingsPage
          isPlanMyPeakEnabled={isPlanMyPeakEnabled}
          isIntervalsEnabled={isIntervalsEnabled}
          onPlanMyPeakEnabledChange={setPlanMyPeakEnabled}
          onIntervalsEnabledChange={setIntervalsEnabled}
          openLogs={openLogs}
        />
      ) : (
        <>
          <ConnectionHealthSummary
            onOpenSettings={() => setActiveView('settings')}
            isTrainingPeaksAuthenticated={isTrainingPeaksAuthenticated}
            isPlanMyPeakEnabled={isPlanMyPeakEnabled}
            isPlanMyPeakAuthenticated={isPlanMyPeakAuthenticated}
            isIntervalsEnabled={isIntervalsEnabled}
            isIntervalsAuthenticated={isIntervalsAuthenticated}
          />

          <AccountMismatchBanner />

          {!canAccessTrainingPeaksData ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="flex items-start justify-between gap-3">
                <div className="pr-2">
                  <p>
                    TrainingPeaks authentication is required to load data. Open
                    Settings to connect accounts. If you are already signed in,
                    Refresh captures it in a background tab without touching
                    your open TrainingPeaks page.
                  </p>
                  {tpAuthRefresh.message ? (
                    <p className="mt-1 font-medium" role="status">
                      {tpAuthRefresh.message}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void handleRefreshTrainingPeaks();
                  }}
                  disabled={
                    isTrainingPeaksAuthLoading || tpAuthRefresh.isRefreshing
                  }
                  className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {tpAuthRefresh.isRefreshing
                    ? 'Refreshing…'
                    : isTrainingPeaksAuthLoading
                      ? 'Checking...'
                      : 'Refresh'}
                </button>
              </div>
            </div>
          ) : null}

          {canAccessTrainingPeaksData ? (
            <>
              <TabNavigation
                activeTab={activeTab}
                onTabChange={handleTabChange}
                pendingCount={pendingCapturedCount}
              />

              {activeTab === 'libraries' ? (
                selectedLibraryId !== null ? (
                  <LibraryDetails
                    libraryId={selectedLibraryId}
                    libraryName={selectedLibraryName}
                    onBack={handleBackToLibraries}
                  />
                ) : (
                  <LibraryList onSelectLibrary={setSelectedLibraryId} />
                )
              ) : activeTab === 'groups' ? (
                <AthleteGroupList />
              ) : activeTab === 'captured' ? (
                <CapturedWorkoutList />
              ) : selectedPlanId !== null ? (
                <PlanCalendar
                  planId={selectedPlanId}
                  onBack={handleBackToPlans}
                />
              ) : (
                <TrainingPlanList onSelectPlan={handleSelectPlan} />
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

export default App;
