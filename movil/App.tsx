import {
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  borrarAudio,
  guardarAudio,
  guardarGrabaciones,
  guardarVinculo,
  leerGrabaciones,
  leerPedazo,
  leerVinculo,
  type Grabacion,
  type Vinculo,
} from './src/almacen'
import { conectar, direccionValida } from './src/asistente'
import { URL_ASISTENTE } from './src/config'
import { cuando, estadoVisible, reloj } from './src/formato'
import { enviarGrabacion, ErrorDefinitivo, nuevoId } from './src/subida'

/**
 * Voz de reunión: mono, 16 kHz y 32 kbps. Es lo que usa Gemini para entender,
 * y deja una hora en unos 14 MB, así que una reunión larga sube rápido.
 */
const GRABACION: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.HIGH },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
}

type EnCurso = { id: string; inicio: number; pausadaPorVos: boolean }

export default function App() {
  const [vinculo, setVinculo] = useState<Vinculo | null | undefined>(undefined)

  useEffect(() => {
    leerVinculo().then(setVinculo).catch(() => setVinculo(null))
  }, [])

  return (
    <SafeAreaProvider>
      <SafeAreaView style={e.pantalla}>
        <StatusBar style="dark" />
        {vinculo === undefined ? (
          <View style={e.centro}>
            <ActivityIndicator />
          </View>
        ) : vinculo === null ? (
          <Vincular alVincular={setVinculo} />
        ) : (
          <Principal
            vinculo={vinculo}
            alDesvincular={async () => {
              await guardarVinculo(null)
              setVinculo(null)
            }}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

// ---------- Vincular ----------

function Vincular({ alVincular }: { alVincular: (v: Vinculo) => void }) {
  const [codigo, setCodigo] = useState('')
  const [url, setUrl] = useState(URL_ASISTENTE)
  const [verUrl, setVerUrl] = useState(!URL_ASISTENTE)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const vincular = async () => {
    setError('')
    const direccion = url.trim()
    if (!direccionValida(direccion)) {
      setError('La dirección del Asistente no es válida. Tiene que terminar en /exec.')
      setVerUrl(true)
      return
    }
    setOcupado(true)
    try {
      const r = await conectar(direccion, 30000)({
        accion: 'vincular',
        codigo,
        dispositivo: `${Platform.OS} ${Platform.Version}`,
      })
      if (!r.ok) throw new Error(r.error)
      const v = { url: direccion, token: r.token, nombre: r.nombre, email: r.email }
      await guardarVinculo(v)
      alVincular(v)
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <KeyboardAvoidingView style={e.vincular} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={e.titulo}>Asistente</Text>
      <Text style={e.parrafo}>
        Para empezar, escribile <Text style={e.negrita}>vincular</Text> al Asistente en Google Chat y poné acá el
        código que te da.
      </Text>
      <TextInput
        style={e.codigo}
        value={codigo}
        onChangeText={(t) => setCodigo(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        placeholder="000000"
        maxLength={6}
        autoFocus
      />
      {verUrl ? (
        <TextInput
          style={e.campo}
          value={url}
          onChangeText={setUrl}
          placeholder="https://script.google.com/macros/s/…/exec"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
      ) : null}
      {error ? <Text style={e.error}>{error}</Text> : null}
      <Boton texto={ocupado ? 'Vinculando…' : 'Vincular'} onPress={vincular} deshabilitado={codigo.length !== 6 || ocupado} />
      {!verUrl ? (
        <Pressable onPress={() => setVerUrl(true)}>
          <Text style={e.enlace}>Cambiar la dirección del Asistente</Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  )
}

// ---------- Grabar y enviar ----------

function Principal({ vinculo, alDesvincular }: { vinculo: Vinculo; alDesvincular: () => void }) {
  const grabador = useAudioRecorder(GRABACION)
  const estadoGrabador = useAudioRecorderState(grabador, 500)
  const [enCurso, setEnCurso] = useState<EnCurso | null>(null)
  const [nota, setNota] = useState('')
  const [lista, setLista] = useState<Grabacion[]>(() => leerGrabaciones())
  const trabajando = useRef(false)

  const actualizar = useCallback((id: string, cambios: Partial<Grabacion>) => {
    setLista((antes) => {
      const nueva = antes.map((g) => (g.id === id ? { ...g, ...cambios } : g))
      guardarGrabaciones(nueva)
      return nueva
    })
  }, [])

  /** Manda lo que falte y pregunta en qué quedó lo ya enviado. */
  const ponerAlDia = useCallback(
    async (tambienDefinitivas = false) => {
      if (trabajando.current) return
      trabajando.current = true
      const pedir = conectar(vinculo.url)
      try {
        const porEnviar = leerGrabaciones().filter(
          (g) => g.estado === 'pendiente' || g.estado === 'subiendo' || (g.estado === 'fallo' && (!g.definitivo || tambienDefinitivas)),
        )
        for (const g of porEnviar) {
          actualizar(g.id, { estado: 'subiendo', error: undefined, definitivo: false })
          try {
            await enviarGrabacion(
              { id: g.id, tamanio: g.tamanio, tipo: g.tipo, nota: g.nota },
              vinculo.token,
              pedir,
              (desde, largo) => leerPedazo(g.archivo, desde, largo),
              { progreso: (n) => actualizar(g.id, { recibidos: n }) },
            )
            actualizar(g.id, { estado: 'enviada', recibidos: g.tamanio })
            borrarAudio(g.archivo)
          } catch (err: any) {
            const definitivo = err instanceof ErrorDefinitivo
            actualizar(g.id, { estado: 'fallo', error: err?.message ?? String(err), definitivo })
            if (definitivo && err.desvinculado) {
              Alert.alert('Teléfono desvinculado', err.message)
              alDesvincular()
              return
            }
          }
        }

        const aConsultar = leerGrabaciones().filter((g) => g.estado === 'enviada' && !g.minuta && g.estadoAsistente !== 'error')
        if (aConsultar.length) {
          const r = await pedir({ accion: 'estado', token: vinculo.token, ids: aConsultar.map((g) => g.id) })
          if (r?.ok) {
            for (const s of r.grabaciones) {
              actualizar(s.id, { estadoAsistente: s.estado, titulo: s.titulo || undefined, minuta: s.minuta || undefined })
            }
          }
        }
      } catch {
        // Sin conexión: se vuelve a intentar al rato o al volver a la app.
      } finally {
        trabajando.current = false
      }
    },
    [vinculo, actualizar, alDesvincular],
  )

  useEffect(() => {
    ponerAlDia()
    const alVolver = AppState.addEventListener('change', (s) => {
      if (s === 'active') ponerAlDia()
    })
    const cadaTanto = setInterval(() => ponerAlDia(), 60000)
    return () => {
      alVolver.remove()
      clearInterval(cadaTanto)
    }
  }, [ponerAlDia])

  const empezar = async () => {
    const permiso = await requestRecordingPermissionsAsync()
    if (!permiso.granted) {
      Alert.alert('Falta el permiso del micrófono', 'Activalo en Ajustes → Asistente → Micrófono.')
      return
    }
    // En Android, grabar con la pantalla apagada muestra un aviso fijo, y el
    // aviso necesita permiso. Sin él se graba igual, con la pantalla prendida.
    let enSegundoPlano = true
    if (Platform.OS === 'android') enSegundoPlano = (await requestNotificationPermissionsAsync()).granted
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        allowsBackgroundRecording: enSegundoPlano,
        interruptionMode: 'doNotMix',
      })
      await grabador.prepareToRecordAsync()
      grabador.record()
      setEnCurso({ id: nuevoId(), inicio: Date.now(), pausadaPorVos: false })
      if (!enSegundoPlano) {
        Alert.alert('Dejá la pantalla prendida', 'Sin el permiso de notificaciones, la grabación se corta si se apaga la pantalla.')
      }
    } catch (err: any) {
      Alert.alert('No pude empezar a grabar', err?.message ?? String(err))
    }
  }

  const pausarOContinuar = () => {
    if (!enCurso) return
    if (estadoGrabador.isRecording) {
      grabador.pause()
      setEnCurso({ ...enCurso, pausadaPorVos: true })
    } else {
      grabador.record()
      setEnCurso({ ...enCurso, pausadaPorVos: false })
    }
  }

  const terminar = async () => {
    if (!enCurso) return
    const duracionMs = estadoGrabador.durationMillis
    try {
      await grabador.stop()
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false })
      const uri = grabador.uri
      if (!uri) throw new Error('El teléfono no guardó el audio.')
      const { archivo, tamanio } = await guardarAudio(uri, enCurso.id)
      const nueva: Grabacion = {
        id: enCurso.id,
        creada: enCurso.inicio,
        duracionMs,
        tamanio,
        tipo: 'audio/mp4',
        nota: nota.trim(),
        archivo,
        estado: 'pendiente',
        recibidos: 0,
      }
      setLista((antes) => {
        const n = [nueva, ...antes]
        guardarGrabaciones(n)
        return n
      })
      setNota('')
      setEnCurso(null)
      setTimeout(() => ponerAlDia(), 0)
    } catch (err: any) {
      Alert.alert('No pude guardar la grabación', err?.message ?? String(err))
    }
  }

  const confirmarTerminar = () =>
    Alert.alert('¿Terminar la grabación?', 'Se envía al Asistente y te llega la minuta por correo.', [
      { text: 'Seguir grabando', style: 'cancel' },
      { text: 'Terminar', style: 'destructive', onPress: terminar },
    ])

  if (enCurso) {
    // Si se detuvo sin que la persona tocara Pausa, fue una llamada u otra app.
    const cortada = !enCurso.pausadaPorVos && !estadoGrabador.isRecording
    return (
      <View style={e.grabando}>
        <View style={e.filaGrabando}>
          <View style={[e.punto, { opacity: estadoGrabador.isRecording ? 1 : 0.25 }]} />
          <Text style={e.estadoGrabando}>{estadoGrabador.isRecording ? 'Grabando' : 'En pausa'}</Text>
        </View>
        <Text style={e.reloj}>{reloj(estadoGrabador.durationMillis)}</Text>
        {nota ? <Text style={e.notaEnCurso}>{nota}</Text> : null}
        {cortada ? (
          <Text style={e.aviso}>Se detuvo por una llamada u otra app que usó el micrófono. Tocá Continuar.</Text>
        ) : (
          <Text style={e.ayuda}>Podés bloquear el teléfono: sigue grabando.</Text>
        )}
        <View style={e.botones}>
          <Boton texto={estadoGrabador.isRecording ? 'Pausar' : 'Continuar'} onPress={pausarOContinuar} secundario />
          <Boton texto="Terminar" onPress={confirmarTerminar} />
        </View>
      </View>
    )
  }

  const enviando = lista.some((g) => g.estado === 'subiendo')
  return (
    <FlatList
      contentContainerStyle={e.principal}
      data={lista}
      keyExtractor={(g) => g.id}
      ListHeaderComponent={
        <View>
          <Text style={e.titulo}>Asistente</Text>
          <Text style={e.parrafo}>Hola, {vinculo.nombre.split(' ')[0]}.</Text>
          <TextInput
            style={e.campo}
            value={nota}
            onChangeText={setNota}
            placeholder="¿Con quién o de qué es? (opcional)"
            maxLength={200}
          />
          <Pressable style={({ pressed }) => [e.grabar, pressed && { opacity: 0.8 }]} onPress={empezar}>
            <Text style={e.grabarTexto}>Grabar</Text>
          </Pressable>
          <Text style={e.ayuda}>Graba aunque bloquees el teléfono. Al terminar, se envía sola.</Text>
          {enviando ? <Text style={e.aviso}>Enviando: dejá la app abierta un momento.</Text> : null}
          {lista.length ? <Text style={e.subtitulo}>Tus grabaciones</Text> : null}
        </View>
      }
      renderItem={({ item }) => <Fila g={item} alReintentar={() => ponerAlDia(true)} />}
      ListFooterComponent={
        <Pressable
          onPress={() =>
            Alert.alert('¿Desvincular este teléfono?', 'Para volver a usarlo vas a necesitar un código nuevo.', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Desvincular', style: 'destructive', onPress: alDesvincular },
            ])
          }
        >
          <Text style={e.enlace}>Vinculado a {vinculo.email} · Desvincular</Text>
        </Pressable>
      }
    />
  )
}

function Fila({ g, alReintentar }: { g: Grabacion; alReintentar: () => void }) {
  const estado = estadoVisible(g)
  const color = estado.tono === 'bien' ? '#137333' : estado.tono === 'mal' ? '#b3261e' : '#5f6368'
  return (
    <View style={e.fila}>
      <View style={{ flex: 1 }}>
        <Text style={e.filaTitulo}>
          {cuando(g.creada)} · {reloj(g.duracionMs)}
        </Text>
        {g.nota ? <Text style={e.filaNota}>{g.nota}</Text> : null}
        <Text style={[e.filaEstado, { color }]}>{estado.texto}</Text>
      </View>
      {estado.accion === 'minuta' ? (
        <Pressable onPress={() => Linking.openURL(g.minuta!)}>
          <Text style={e.filaAccion}>Abrir</Text>
        </Pressable>
      ) : estado.accion === 'reintentar' ? (
        <Pressable onPress={alReintentar}>
          <Text style={e.filaAccion}>Reintentar</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function Boton(p: { texto: string; onPress: () => void; deshabilitado?: boolean; secundario?: boolean }) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.deshabilitado}
      style={({ pressed }) => [
        e.boton,
        p.secundario && e.botonSecundario,
        (p.deshabilitado || pressed) && { opacity: 0.5 },
      ]}
    >
      <Text style={[e.botonTexto, p.secundario && e.botonTextoSecundario]}>{p.texto}</Text>
    </Pressable>
  )
}

const ROJO = '#d93025'

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: '#fff' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  vincular: { flex: 1, padding: 24, paddingTop: 64, gap: 16 },
  principal: { padding: 24, paddingTop: 48, gap: 4 },
  titulo: { fontSize: 32, fontWeight: '700', color: '#202124' },
  subtitulo: { fontSize: 18, fontWeight: '600', color: '#202124', marginTop: 32, marginBottom: 8 },
  parrafo: { fontSize: 17, lineHeight: 24, color: '#3c4043', marginTop: 8, marginBottom: 16 },
  negrita: { fontWeight: '700' },
  codigo: {
    fontSize: 36, letterSpacing: 12, textAlign: 'center', paddingVertical: 12,
    borderWidth: 1, borderColor: '#dadce0', borderRadius: 12,
  },
  campo: { fontSize: 16, padding: 14, borderWidth: 1, borderColor: '#dadce0', borderRadius: 12 },
  error: { color: '#b3261e', fontSize: 15 },
  enlace: { color: '#1a73e8', fontSize: 15, textAlign: 'center', marginTop: 24 },
  grabar: {
    alignSelf: 'center', width: 200, height: 200, borderRadius: 100, backgroundColor: ROJO,
    alignItems: 'center', justifyContent: 'center', marginTop: 32, marginBottom: 16,
  },
  grabarTexto: { color: '#fff', fontSize: 26, fontWeight: '700' },
  ayuda: { fontSize: 15, color: '#5f6368', textAlign: 'center', marginTop: 8 },
  aviso: { fontSize: 15, color: '#b06000', textAlign: 'center', marginTop: 12 },
  grabando: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 12 },
  filaGrabando: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  punto: { width: 14, height: 14, borderRadius: 7, backgroundColor: ROJO },
  estadoGrabando: { fontSize: 18, color: '#3c4043' },
  reloj: { fontSize: 64, fontWeight: '300', fontVariant: ['tabular-nums'], color: '#202124' },
  notaEnCurso: { fontSize: 16, color: '#5f6368', textAlign: 'center' },
  botones: { flexDirection: 'row', gap: 16, marginTop: 40 },
  boton: { backgroundColor: ROJO, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center' },
  botonSecundario: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dadce0' },
  botonTexto: { color: '#fff', fontSize: 18, fontWeight: '600' },
  botonTextoSecundario: { color: '#202124' },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dadce0',
  },
  filaTitulo: { fontSize: 16, fontWeight: '600', color: '#202124' },
  filaNota: { fontSize: 15, color: '#3c4043', marginTop: 2 },
  filaEstado: { fontSize: 14, marginTop: 4 },
  filaAccion: { color: '#1a73e8', fontSize: 16, fontWeight: '600' },
})
