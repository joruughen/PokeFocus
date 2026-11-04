import { useRouteParams } from '../../router'
import { Box } from './Box'
import { Detail } from './Detail'

/** `#/box` → grid; `#/box/<uid>` → detail sheet. */
export default function BoxRoute() {
  const [uid] = useRouteParams()
  return uid ? <Detail key={uid} uid={uid} /> : <Box />
}
