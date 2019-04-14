// Theirs
import React from 'react'
import domtoimage from 'dom-to-image'
import dynamic from 'next/dynamic'
import Dropzone from 'dropperx'

// Ours
import ApiContext from './ApiContext'
import Dropdown from './Dropdown'
import Settings from './Settings'
import Toolbar from './Toolbar'
import Overlay from './Overlay'
import Carbon from './Carbon'
import ExportMenu from './ExportMenu'
import Themes from './Themes'
import TweetButton from './TweetButton'
import {
  LANGUAGES,
  LANGUAGE_MIME_HASH,
  LANGUAGE_MODE_HASH,
  LANGUAGE_NAME_HASH,
  DEFAULT_EXPORT_SIZE,
  COLORS,
  EXPORT_SIZES_HASH,
  DEFAULT_CODE,
  DEFAULT_SETTINGS,
  DEFAULT_LANGUAGE,
  DEFAULT_PRESET_ID,
  DEFAULT_THEME,
  THEMES
} from '../lib/constants'
import { serializeState, getRouteState } from '../lib/routing'
import { getThemes, saveThemes, getSettings, unescapeHtml, formatCode, omit } from '../lib/util'
import LanguageIcon from './svg/Language'

const languageIcon = <LanguageIcon />

const BackgroundSelect = dynamic(() => import('./BackgroundSelect'), {
  loading: () => null
})

class Editor extends React.Component {
  static contextType = ApiContext

  constructor(props) {
    super(props)
    this.state = {
      ...DEFAULT_SETTINGS,
      themes: THEMES,
      preset: DEFAULT_PRESET_ID,
      loading: true
    }

    this.export = this.export.bind(this)
    this.upload = this.upload.bind(this)
    this.updateSetting = this.updateSetting.bind(this)
    this.updateLanguage = this.updateLanguage.bind(this)
    this.updateBackground = this.updateBackground.bind(this)
    this.resetDefaultSettings = this.resetDefaultSettings.bind(this)
    this.getCarbonImage = this.getCarbonImage.bind(this)
    this.onDrop = this.onDrop.bind(this)
  }

  async componentDidMount() {
    const { queryState, parameter } = getRouteState(this.props.router)

    // TODO we could create an interface for loading this config, so that it looks identical
    // whether config is loaded from localStorage, gist, or even something like IndexDB
    let gistState
    if (this.context.gist && parameter) {
      const { config, ...gist } = (await this.context.gist.get(parameter)) || {}
      if (typeof config === 'object') {
        this.gist = gist
        gistState = config
      }
    }

    const newState = {
      // Load options from gist or localStorage
      ...(gistState ? gistState : getSettings(localStorage)),
      // and then URL params
      ...queryState,
      loading: false
    }

    const storedThemes = getThemes(localStorage) || []

    newState.themes = [...storedThemes, ...this.state.themes]

    if (newState.theme) {
      newState.theme = newState.themes.find(t => t.id === newState.theme) || DEFAULT_THEME
    }

    if (newState.highlights) {
      newState.theme = {
        ...newState.theme,
        highlights: newState.highlights
      }
    }

    // Makes sure the slash in 'application/X' is decoded
    if (newState.language) {
      newState.language = unescapeHtml(newState.language)
    }

    this.updateState(omit(newState, ['highlights']))

    this.isSafari =
      window.navigator &&
      window.navigator.userAgent.indexOf('Safari') !== -1 &&
      window.navigator.userAgent.indexOf('Chrome') === -1
  }

  carbonNode = React.createRef()

  updateState = updates => {
    this.setState(updates, () => {
      if (!this.gist) {
        this.props.onUpdate({
          ...this.state,
          theme: this.state.theme.id
        })
      }
    })
  }

  updateCode = code => this.updateState({ code })

  async getCarbonImage(
    {
      format,
      type,
      squared = this.state.squaredImage,
      exportSize = (EXPORT_SIZES_HASH[this.state.exportSize] || DEFAULT_EXPORT_SIZE).value
    } = { format: 'png' }
  ) {
    // if safari, get image from api
    const isPNG = format !== 'svg'
    if (this.context.image && this.isSafari && isPNG) {
      const state = {
        ...this.state,
        theme: this.state.theme.id,
        highlights: this.state.theme.highlights
      }

      const encodedState = serializeState(omit(state, ['themes']))

      return this.context.image(encodedState)
    }

    const node = this.carbonNode.current

    const map = new Map()
    const undoMap = value => {
      map.forEach((value, node) => (node.innerText = value))
      return value
    }

    if (isPNG) {
      node.querySelectorAll('span[role="presentation"]').forEach(node => {
        if (node.innerText && node.innerText.match(/%[A-Za-z0-9]{2}/)) {
          map.set(node, node.innerText)
          node.innerText.match(/%[A-Za-z0-9]{2}/g).forEach(t => {
            node.innerText = node.innerText.replace(t, encodeURIComponent(t))
          })
        }
      })
    }

    const width = node.offsetWidth * exportSize
    const height = squared ? node.offsetWidth * exportSize : node.offsetHeight * exportSize

    const config = {
      style: {
        transform: `scale(${exportSize})`,
        'transform-origin': 'center',
        background: squared ? this.state.backgroundColor : 'none'
      },
      filter: n => {
        if (n.className) {
          return String(n.className).indexOf('eliminateOnRender') < 0
        }
        return true
      },
      width,
      height
    }

    // current font-family used
    const fontFamily = this.state.fontFamily
    try {
      if (type === 'blob') {
        if (format === 'svg') {
          return (
            domtoimage
              .toSvg(node, config)
              .then(dataUrl =>
                dataUrl
                  .replace(/&nbsp;/g, '&#160;')
                  // https://github.com/tsayen/dom-to-image/blob/fae625bce0970b3a039671ea7f338d05ecb3d0e8/src/dom-to-image.js#L551
                  .replace(/%23/g, '#')
                  .replace(/%0A/g, '\n')
                  // remove other fonts which are not used
                  .replace(
                    new RegExp('@font-face\\s+{\\s+font-family: (?!"*' + fontFamily + ').*?}', 'g'),
                    ''
                  )
              )
              // https://stackoverflow.com/questions/7604436/xmlparseentityref-no-name-warnings-while-loading-xml-into-a-php-file
              .then(dataUrl => dataUrl.replace(/&(?!#?[a-z0-9]+;)/g, '&amp;'))
              .then(uri => uri.slice(uri.indexOf(',') + 1))
              .then(data => new Blob([data], { type: 'image/svg+xml' }))
              .then(data => window.URL.createObjectURL(data))
          )
        }

        return await domtoimage.toBlob(node, config).then(blob => window.URL.createObjectURL(blob))
      }

      // Twitter needs regular dataurls
      return await domtoimage.toPng(node, config)
    } finally {
      undoMap()
    }
  }

  updateSetting(key, value) {
    this.updateState({ [key]: value })
    if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
      this.updateState({ preset: null })
    }
  }

  export(format = 'png') {
    const link = document.createElement('a')

    const prefix = this.state.filename || 'carbon'

    return this.getCarbonImage({ format, type: 'blob' }).then(url => {
      if (format !== 'open') {
        link.download = `${prefix}.${format}`
      }
      link.href = url
      document.body.appendChild(link)
      link.click()
      link.remove()
    })
  }

  resetDefaultSettings() {
    this.updateState({ ...DEFAULT_SETTINGS, preset: DEFAULT_PRESET_ID })
    this.props.onReset()
  }

  upload() {
    this.getCarbonImage({ format: 'png' }).then(
      this.context.tweet.bind(null, this.state.code || DEFAULT_CODE)
    )
  }

  onDrop([file]) {
    if (isImage(file)) {
      this.updateState({
        backgroundImage: file.content,
        backgroundImageSelection: null,
        backgroundMode: 'image',
        preset: null
      })
    } else {
      this.updateState({ code: file.content, language: 'auto' })
    }
  }

  updateLanguage(language) {
    this.updateSetting('language', language.mime || language.mode)
  }

  updateBackground({ photographer, ...changes } = {}) {
    if (photographer) {
      this.updateState(({ code = DEFAULT_CODE }) => ({
        ...changes,
        code: code + `\n\n// Photo by ${photographer.name} on Unsplash`,
        preset: null
      }))
    } else {
      this.updateState({ ...changes, preset: null })
    }
  }

  updateTheme = theme => this.updateState({ theme })

  createTheme = theme =>
    this.setState(({ themes }) => {
      const newThemes = [theme, ...themes]

      saveThemes(localStorage, newThemes.filter(({ custom }) => custom))

      return {
        theme,
        themes: newThemes
      }
    })

  removeTheme = id =>
    this.setState(({ themes, theme }) => {
      const newState = {
        themes: themes.filter(t => t.id !== id)
      }

      saveThemes(localStorage, newState.themes.filter(({ custom }) => custom))

      if (theme.id === id) {
        newState.theme = DEFAULT_THEME
      }

      return newState
    })

  format = () =>
    formatCode(this.state.code)
      .then(this.updateCode)
      .catch(() => {
        // create toast here in the future
      })

  render() {
    const {
      theme,
      themes,
      language,
      backgroundColor,
      backgroundImage,
      backgroundMode,
      code,
      exportSize
    } = this.state

    const config = omit(this.state, ['code'])

    return (
      <div className="editor">
        <Toolbar>
          <Themes
            update={this.updateTheme}
            remove={this.removeTheme}
            create={this.createTheme}
            theme={theme}
            themes={themes}
          />
          <Dropdown
            icon={languageIcon}
            selected={
              LANGUAGE_NAME_HASH[language] ||
              LANGUAGE_MIME_HASH[language] ||
              LANGUAGE_MODE_HASH[language] ||
              LANGUAGE_MODE_HASH[DEFAULT_LANGUAGE]
            }
            list={LANGUAGES}
            onChange={this.updateLanguage}
          />
          <BackgroundSelect
            onChange={this.updateBackground}
            mode={backgroundMode}
            color={backgroundColor}
            image={backgroundImage}
            carbonRef={this.carbonNode.current}
          />
          <Settings
            {...config}
            onChange={this.updateSetting}
            resetDefaultSettings={this.resetDefaultSettings}
            format={this.format}
            applyPreset={this.applyPreset}
            getCarbonImage={this.getCarbonImage}
          />
          <div className="buttons">
            <TweetButton onClick={this.upload} />
            <ExportMenu
              onChange={this.updateSetting}
              export={this.export}
              exportSize={exportSize}
              backgroundImage={backgroundImage}
            />
          </div>
        </Toolbar>

        <Dropzone accept="image/*, text/*, application/*" onDrop={this.onDrop}>
          {({ canDrop }) => (
            <Overlay
              isOver={canDrop}
              title={`Drop your file here to import ${canDrop ? '✋' : '✊'}`}
            >
              {/*key ensures Carbon's internal language state is updated when it's changed by Dropdown*/}
              <Carbon
                key={language}
                ref={this.carbonNode}
                config={this.state}
                onChange={this.updateCode}
                loading={this.state.loading}
              >
                {code != null ? code : DEFAULT_CODE}
              </Carbon>
            </Overlay>
          )}
        </Dropzone>
        <style jsx>
          {`
            .editor {
              background: ${COLORS.BLACK};
              border: 3px solid ${COLORS.SECONDARY};
              border-radius: 8px;
              padding: 16px;
            }

            .buttons {
              display: flex;
              margin-left: auto;
            }
          `}
        </style>
      </div>
    )
  }
}

function isImage(file) {
  return file.type.split('/')[0] === 'image'
}

Editor.defaultProps = {
  onUpdate: () => {},
  onReset: () => {}
}

export default Editor
