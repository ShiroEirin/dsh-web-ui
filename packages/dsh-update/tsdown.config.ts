import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-update', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-host-webserver',
  ],
})
