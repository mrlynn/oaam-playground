import useBaseUrl from '@docusaurus/useBaseUrl';
import {useState} from 'react';

import {conversation, DEFAULT_CONVERSATION} from './data';
import ReplayView, {type View} from './ReplayView';

/** A self-contained replay for a page that isn't the replay page: links out go to /replay. */
export default function TurnReplay({conversation: key = DEFAULT_CONVERSATION, turn, view = 'why'}: {conversation?: string; turn?: number; view?: View}) {
  const c = conversation(key);
  const [state, setState] = useState({c: c.key, turn: turn ?? c.turns.length, view});
  const replay = useBaseUrl('/replay');
  return (
    <ReplayView
      state={state}
      onChange={setState}
      findingHref={(id) => `${replay}#finding-${id}`}
      otherRunHref={(k, t) => `${replay}?c=${k}&turn=${t}`}
    />
  );
}
