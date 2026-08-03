/// INTERFACE STUB — `decibel::vault_read_api`, the PUBLIC read surface for vaults.
///
/// Verified against the live ABI of the current package 0xe7da27…b7f (testnet) and
/// 0x50ead2…db06 (mainnet) on 2026-08-03. Both expose, with `public` visibility:
///
///   public fun get_vault_num_shares(Object<Vault>): u64
///   public fun get_vault_share_asset_type(Object<Vault>): Object<Metadata>
///   public fun get_vault_net_asset_value(Object<Vault>): u64
///
/// The identically-named functions on `vault` itself are `friend`-visible and uncallable from
/// a strategy module — the same trap as `perp_engine` vs `public_read_api`.
///
/// `sealed_vault` uses the first two to answer one question: does anyone OTHER than the
/// creator hold shares in this vault? Total shares minus the creator's balance. It is used to
/// decide whether swapping the vault's strategy needs a depositor-notice period, and it is
/// deliberately biased safe — any share the creator holds somewhere we cannot see (a Decibel
/// subaccount, a second wallet) reads as an outside holder and makes the check STRICTER, never
/// laxer.
///
/// Stubs only; never published.
module decibel::vault_read_api {
    use aptos_framework::fungible_asset::Metadata;
    use aptos_framework::object::Object;
    use decibel::vault::Vault;

    public fun get_vault_num_shares(_vault: Object<Vault>): u64 { abort 0 }
    public fun get_vault_share_asset_type(_vault: Object<Vault>): Object<Metadata> { abort 0 }
    public fun get_vault_net_asset_value(_vault: Object<Vault>): u64 { abort 0 }
}
