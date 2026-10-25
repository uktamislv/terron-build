import { botLink, stripLaunchParamsFromUrl } from './telegram'

describe('stripLaunchParamsFromUrl', () => {
  it('#tgWebAppData... olib tashlanadi, yo‘l va query saqlanadi', () => {
    window.history.replaceState(null, '', '/tg/mine?x=1#tgWebAppData=query_id%3D1%26hash%3Dabc&tgWebAppVersion=7.0')
    stripLaunchParamsFromUrl()
    expect(window.location.pathname).toBe('/tg/mine')
    expect(window.location.search).toBe('?x=1')
    expect(window.location.hash).toBe('')
  })

  it('boshqa hash tegilmaydi', () => {
    window.history.replaceState(null, '', '/tg#bolim')
    stripLaunchParamsFromUrl()
    expect(window.location.hash).toBe('#bolim')
  })
})

describe('botLink', () => {
  it('@ belgisisiz havola', () => {
    expect(botLink('@terron_bot')).toBe('https://t.me/terron_bot')
  })
})
