/// INTERFACE STUB — `decibel::vault`. Only the opaque Vault resource handle is needed
/// (sealed_vault passes it as `Object<Vault>` to vault_read_api). Layout irrelevant; never
/// published.
module decibel::vault {
    struct Vault has key { v: u8 }
}
