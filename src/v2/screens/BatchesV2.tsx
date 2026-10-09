import React from 'react';
import type { Project } from '../../studio/store';
import GroupWorkspace from '../../studio/screens/GroupWorkspace';
import './stages-v2.css';

/* סשנים. The stage bar above already names the stage and leads on to סינון, so
 * the screen opens straight on the work: the day map, the sessions and the
 * photographs. The "שלב 2 · סשנים" heading and its "המשך לסינון" button were a
 * second copy of that bar and are gone. */
export default function BatchesV2({
  project,
}: {
  project: Project;
  onNext?: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="tz-stage-container tz-stage-groups fo-gw">
      <GroupWorkspace projectId={project.id} />
    </div>
  );
}
