---
trigger: model_decision
description: Aplica cuando se diseñe o implemente código de sensores móviles, WebRTC, calibración o controles del cliente móvil.
---

# Reglas para sensores y baja latencia (Móvil -> PC)

Cuando trabajes en `apps/controller-mobile`, `apps/signaling-server` o la capa de entrada de `apps/host-web`:

1. **Compatibilidad iOS y Android:**
   - Solicitar permiso de sensores (`DeviceMotionEvent.requestPermission`) únicamente dentro de un evento de clic/toque del usuario.
   - Normalizar ejes y manejar dispositivos Android donde `event.acceleration` pueda ser `null` (usando `accelerationIncludingGravity` con filtro paso bajo).
2. **Prevención de suspensión:**
   - Activar `navigator.wakeLock.request('screen')` durante la partida y re-solicitarlo al volver el foco (`visibilitychange`).
3. **Transporte de red:**
   - Enviar telemetría de sensores por canal no fiable y sin orden para evitar *head-of-line blocking*.
   - Incluir `timestamp` del cliente en cada paquete y descartar paquetes más viejos que el último procesado.
4. **Seguridad física (UX):**
   - Evitar mecánicas que inciten a soltar o lanzar el teléfono con fuerza; priorizar gestos controlados de muñeca o sostener un botón físico en pantalla.
