export default function TerminosPage() {
  return (
    <div className="min-h-screen bg-texter-bg flex flex-col items-center p-4 sm:p-6">
      <div className="w-full max-w-2xl py-10 space-y-6 text-sm text-texter-text-secondary">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Términos del servicio — nextex
        </h1>
        <p className="text-xs text-texter-text-dim">
          Última actualización: 26 de octubre de 2026. Este texto es
          informativo y describe las reglas reales de uso de la plataforma; no
          constituye asesoría legal.
        </p>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">El servicio</h2>
          <p>
            nextex es una plataforma de inteligencia artificial y automatización
            para negocios. Se ofrece &quot;tal cual&quot;, sin garantía de
            disponibilidad ininterrumpida, y puede cambiar sus funciones con
            aviso previo.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">Uso aceptable</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Usa la plataforma solo para tus propios negocios o para clientes que te hayan autorizado expresamente.</li>
            <li>No simules tráfico, vistas, pedidos ni interacciones falsas sobre terceros.</li>
            <li>No intentes acceder a datos de otros negocios ni eludir los controles de acceso.</li>
            <li>No uses el servicio para actividades ilegales ni para enviar spam.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">Cuentas y suspensión</h2>
          <p>
            Eres responsable de tu cuenta y de tus credenciales. Podemos
            suspender una cuenta que viole estos términos o que presente
            actividad sospechosa; la suspensión bloquea el acceso a paneles y
            APIs hasta que se resuelva con el administrador.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">Facturación</h2>
          <p>
            Las suscripciones se facturan por periodo. La falta de pago genera
            mora y, pasados los días de gracia más 7 días, la suspensión del
            servicio (incluido el chat del widget) hasta regularizar. Los
            importes se calculan siempre en el servidor.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">Contacto</h2>
          <p>
            Para dudas sobre estos términos, escribe a
            jordanygenao84@gmail.com.
          </p>
        </section>
      </div>
    </div>
  );
}
