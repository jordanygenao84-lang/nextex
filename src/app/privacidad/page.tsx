export default function PrivacidadPage() {
  return (
    <div className="min-h-screen bg-texter-bg flex flex-col items-center p-4 sm:p-6">
      <div className="w-full max-w-2xl py-10 space-y-6 text-sm text-texter-text-secondary">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Política de privacidad — nextex
        </h1>
        <p className="text-xs text-texter-text-dim">
          Última actualización: 26 de octubre de 2026. Este texto es
          informativo y describe cómo funciona realmente la plataforma; no
          constituye asesoría legal.
        </p>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">Qué datos recogemos</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Datos de contacto de los negocios clientes (nombre, correo, teléfono) para operar su cuenta.</li>
            <li>Mensajes que los visitantes escriben en el chat del widget de cada negocio.</li>
            <li>Métricas agregadas del negocio (visitas, ventas, órdenes) que el propio negocio reporta.</li>
            <li>Eventos de seguridad y errores técnicos (direcciones IP, tipo de evento) para proteger la plataforma.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">Qué datos NO recogemos ni guardamos</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Contraseñas: solo las gestiona el proveedor de autenticación, nunca en texto plano.</li>
            <li>Valores de credenciales de terceros: solo se guarda metadata (nombre, expiración); los valores van cifrados en una bóveda separada.</li>
            <li>Datos de tarjetas: nextex no procesa ni almacena pagos con tarjeta.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">Dónde se guardan y por cuánto tiempo</h2>
          <p>
            Los datos viven en Supabase y Vercel, con respaldos semanales
            cifrados en almacenamiento privado. Los eventos de seguridad se
            conservan 90 días y los incidentes 365 días; después se eliminan
            automáticamente.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">Tus derechos</h2>
          <p>
            Puedes pedir acceso, rectificación o supresión de tus datos
            escribiendo a jordanygenao84@gmail.com con el asunto
            &quot;Supresión de cuenta&quot; (para cuentas) o
            &quot;Datos personales&quot; (para mensajes del widget). Las
            solicitudes se procesan manualmente y se confirman por el mismo
            correo.
          </p>
        </section>
      </div>
    </div>
  );
}
