/// INTERFACE STUB — `decibel::perp_engine_api`, the PUBLIC builder-code surface.
///
/// Verified against the live ABI of the current package 0xe7da27…b7f (testnet) and
/// 0x50ead2…db06 (mainnet) on 2026-08-03. Both expose, with `public` visibility:
///
///   public fun new_builder_code(address, u64): BuilderCode
///   public fun approve_max_fee(&signer, address, u64)
///   public fun revoke_max_fee(&signer, address)
///
/// This module exists because `builder_code_registry`'s own `new_builder_code` and
/// `approve_max_fee` are `friend`-visible and therefore uncallable from a strategy module —
/// the same trap as `perp_engine` vs `public_read_api`. Builder-code construction uses this
/// public wrapper.
///
/// The fee unit is HUNDREDTHS of a basis point: 1 bp == 100. See
/// `DECIBEL_BUILDER_CHAIN_UNITS_PER_BPS` in lib/decibel.ts, which uses the same scale.
///
/// Approval note: the approval is recorded for `signer::address_of(signer)`. A strategy object
/// signer is not the Decibel vault's primary trading subaccount. A vault admin cannot grant the
/// approval on that subaccount's behalf through the public owner-scoped entry function —
/// `dex_accounts_entry::approve_max_builder_fee_for_subaccount` aborts with
/// EBUILDER_SUBACCOUNT_NOT_FOUND when the subaccount is not one of the signer's own. Automated
/// vaults therefore use a zero builder fee and never call `approve_max_fee`; the declaration
/// remains in this ABI stub because it exists in Decibel's published module.
///
/// Stubs only; never published.
module decibel::perp_engine_api {
    use decibel::builder_code_registry::BuilderCode;

    public fun new_builder_code(_builder: address, _fees: u64): BuilderCode { abort 0 }
    public fun approve_max_fee(_account: &signer, _builder: address, _max_fee: u64) { abort 0 }
    public fun revoke_max_fee(_account: &signer, _builder: address) { abort 0 }
}
