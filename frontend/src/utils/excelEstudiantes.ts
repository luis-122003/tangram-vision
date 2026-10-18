/**
 * Lectura y escritura de los Excel del alta masiva de estudiantes.
 *
 * `exceljs` pesa cerca de un mega, así que se carga solo cuando el docente usa
 * esta función (import dinámico): el resto del panel no lo descarga nunca.
 */
import type { BulkRow } from "../types";

/** Una fila del Excel del docente, ya leída y con su problema si lo tiene. */
export interface FilaImportada {
  /** Número de fila en la hoja, para que el docente la encuentre. */
  fila:     number;
  name:     string;
  email:    string;
  problema: string | null;
}

async function cargarExcelJS() {
  const modulo = await import("exceljs");
  // Según el empaquetado llega como `default` o como el módulo mismo.
  return (modulo as unknown as { default?: typeof modulo }).default ?? modulo;
}

/** Quita tildes, espacios y mayúsculas, para comparar encabezados. */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * El valor de una celda como texto. Una celda de Excel puede ser un número, un
 * hipervínculo (Excel convierte los correos en enlaces al escribirlos), texto
 * con formato o una fórmula: de cada uno se toma lo que se ve.
 */
function textoDe(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object") {
    const v = valor as {
      text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string;
    };
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join("").trim();
    if (v.text !== undefined) return textoDe(v.text);
    if (v.result !== undefined) return textoDe(v.result);
    if (typeof v.hyperlink === "string") return v.hyperlink.replace(/^mailto:/i, "").trim();
    return "";
  }
  return String(valor).trim();
}

const esCorreo = (c: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);

/**
 * Lee la primera hoja del Excel.
 *
 * Busca la fila de encabezados en las cinco primeras (puede haber un título
 * encima) y reconoce las columnas por su nombre: «Nombres», «Apellidos» y
 * «Correo»/«Email», sin importar tildes ni mayúsculas. También vale una sola
 * columna «Nombre completo». El correo es opcional.
 */
export async function leerExcelEstudiantes(archivo: File): Promise<FilaImportada[]> {
  const ExcelJS = await cargarExcelJS();
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(await archivo.arrayBuffer());
  } catch {
    throw new Error("No se pudo leer el archivo. Tiene que ser un Excel .xlsx.");
  }
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error("El Excel no tiene ninguna hoja.");

  let filaEncabezado = 0;
  let colNombre = 0, colApellido = 0, colCorreo = 0;
  for (let f = 1; f <= Math.min(5, hoja.rowCount) && filaEncabezado === 0; f++) {
    hoja.getRow(f).eachCell((celda, col) => {
      const h = normalizar(textoDe(celda.value));
      if (/^nombres?( completos?)?$/.test(h) || h === "nombre y apellido" ||
          h === "estudiante") colNombre ||= col;
      else if (/^apellidos?$/.test(h)) colApellido ||= col;
      else if (/correo|e-?mail/.test(h)) colCorreo ||= col;
    });
    if (colNombre) filaEncabezado = f;
  }
  if (!filaEncabezado) {
    throw new Error(
      "No encontré la columna «Nombres» en las primeras filas. Usa la plantilla: " +
      "Nombres | Apellidos | Correo.",
    );
  }

  const filas: FilaImportada[] = [];
  const vistos = new Map<string, number>();
  for (let f = filaEncabezado + 1; f <= hoja.rowCount; f++) {
    const row = hoja.getRow(f);
    const nombre = textoDe(row.getCell(colNombre).value);
    const apellido = colApellido ? textoDe(row.getCell(colApellido).value) : "";
    const email = colCorreo ? textoDe(row.getCell(colCorreo).value).toLowerCase() : "";
    if (!nombre && !apellido && !email) continue;   // fila vacía

    const name = `${nombre} ${apellido}`.replace(/\s+/g, " ").trim();
    let problema: string | null = null;
    if (name.length < 2) problema = "Falta el nombre";
    else if (email && !esCorreo(email)) problema = "El correo no tiene un formato válido";
    else if (email && vistos.has(email)) problema = `Correo repetido (fila ${vistos.get(email)})`;
    if (email && !vistos.has(email)) vistos.set(email, f);

    filas.push({ fila: f, name, email, problema });
  }
  if (filas.length === 0) throw new Error("El Excel no trae ningún estudiante debajo de los encabezados.");
  return filas;
}

function descargar(buffer: ArrayBuffer, nombreArchivo: string): void {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Plantilla vacía para que el docente pegue su listado. */
export async function descargarPlantilla(): Promise<void> {
  const ExcelJS = await cargarExcelJS();
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Estudiantes");
  hoja.columns = [
    { header: "Nombres", width: 24 },
    { header: "Apellidos", width: 26 },
    { header: "Correo", width: 34 },
  ];
  hoja.getRow(1).font = { bold: true };
  const ayuda = libro.addWorksheet("Instrucciones");
  ayuda.getColumn(1).width = 100;
  [
    "Escribe un estudiante por fila en la hoja «Estudiantes».",
    "El correo es opcional. Si no lo pones, se genera un usuario (p. ej. juan.perez)",
    "y el estudiante escribe su correo en la app la primera vez que entra.",
    "Si lo pones, ese correo será su usuario y le llegará un código para confirmarlo.",
    "Después cada estudiante elige su propia clave de cuatro números.",
  ].forEach(t => ayuda.addRow([t]));
  descargar(await libro.xlsx.writeBuffer(), "plantilla-estudiantes.xlsx");
}

/**
 * El Excel con las credenciales: lo único que el docente tiene para repartir
 * las claves, que el servidor no vuelve a enseñar.
 */
export async function descargarCredenciales(filas: BulkRow[]): Promise<void> {
  const ExcelJS = await cargarExcelJS();
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Credenciales");
  hoja.columns = [
    { header: "Nombre", key: "name", width: 30 },
    { header: "Usuario", key: "username", width: 34 },
    { header: "Contraseña", key: "password", width: 14 },
    { header: "Correo", key: "email", width: 34 },
    { header: "Estado", key: "estado", width: 40 },
  ];
  hoja.getRow(1).font = { bold: true };
  for (const r of filas) {
    hoja.addRow({
      name: r.name,
      username: r.username ?? "",
      // Como texto: «0123» como número perdería el cero.
      password: r.password ?? "",
      email: r.email ?? "",
      estado: r.ok
        ? r.email ? "Creada · confirmará el correo al entrar" : "Creada · escribirá su correo al entrar"
        : `No creada: ${r.error ?? ""}`,
    });
  }
  hoja.getColumn("password").numFmt = "@";
  const hoy = new Date().toISOString().slice(0, 10);
  descargar(await libro.xlsx.writeBuffer(), `credenciales-estudiantes-${hoy}.xlsx`);
}
