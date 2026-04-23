import FanControl from './FanControl.jsx';
import LightControl from './LightControl.jsx';
import SensorPanel from './SensorPanel.jsx';
import DataChart from './DataChart.jsx';
import ScheduleEditor from './ScheduleEditor.jsx';
import AlertSettings from './AlertSettings.jsx';
import SpeciesPicker from './SpeciesPicker.jsx';
import ActivityLog from './ActivityLog.jsx';

export default function Dashboard({ status, alerts, settings, onRefresh }) {
  if (!status) {
    return <div className="py-12 text-center text-slate-400">Loading…</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <FanControl status={status} settings={settings} onRefresh={onRefresh} />
      <LightControl status={status} onRefresh={onRefresh} />
      <div className="md:col-span-2">
        <SensorPanel sensor={status.sensor} alerts={alerts} />
      </div>
      <div className="md:col-span-2">
        <DataChart />
      </div>
      <ScheduleEditor onRefresh={onRefresh} />
      <AlertSettings alerts={alerts} onRefresh={onRefresh} />
      <SpeciesPicker settings={settings} onRefresh={onRefresh} />
      <ActivityLog />
    </div>
  );
}
