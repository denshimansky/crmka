// Реквизиты исполнителя (получателя платежей) для счетов-договоров оферты.
// Значения по умолчанию — ИП Шиманский (публичны, дублируются в /offer);
// env-переменные BILLING_EXECUTOR_* позволяют сменить банк/адрес без релиза.

export interface ExecutorRequisites {
  /** Полное наименование (как в банковских документах) */
  name: string
  /** Короткое имя для блока подписей */
  shortName: string
  inn: string
  ogrnip: string
  address: string
  bankName: string
  bik: string
  /** Корреспондентский счёт банка */
  corrAccount: string
  /** Расчётный счёт получателя */
  account: string
}

export const EXECUTOR: ExecutorRequisites = {
  name:
    process.env.BILLING_EXECUTOR_NAME ||
    "ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ ШИМАНСКИЙ ДЕНИС ВАДИМОВИЧ",
  shortName: process.env.BILLING_EXECUTOR_SHORT_NAME || "ИП Шиманский Д.В.",
  inn: process.env.BILLING_EXECUTOR_INN || "500601429006",
  ogrnip: process.env.BILLING_EXECUTOR_OGRNIP || "316503200066452",
  address:
    process.env.BILLING_EXECUTOR_ADDRESS ||
    "143091, РОССИЯ, МОСКОВСКАЯ ОБЛ, Г КРАСНОЗНАМЕНСК, УЛ ГЕНЕРАЛА ШЛЫКОВА, Д 5А, КВ 113",
  bankName: process.env.BILLING_EXECUTOR_BANK || "АО «ТБанк»",
  bik: process.env.BILLING_EXECUTOR_BIK || "044525974",
  corrAccount: process.env.BILLING_EXECUTOR_CORR_ACCOUNT || "30101810145250000974",
  account:
    process.env.TBANK_ACCOUNT_NUMBER ||
    process.env.BILLING_EXECUTOR_ACCOUNT ||
    "40802810200005974620",
}
