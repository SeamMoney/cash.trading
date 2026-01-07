module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order {
    enum Order has copy, drop, store {
        V1 {
            id: u64,
            user_addr: address,
            market: address,
            orig_sz: u64,
            sz: u64,
            px: u64,
            is_buy: bool,
            order_type: u8,
            timestamp: u64,
        }
    }
    public fun id(p0: &Order): u64 {
        assert!(p0 is V1, 14566554180833181697);
        *&p0.id
    }
    public fun user_addr(p0: &Order): address {
        assert!(p0 is V1, 14566554180833181697);
        *&p0.user_addr
    }
    public fun market(p0: &Order): address {
        assert!(p0 is V1, 14566554180833181697);
        *&p0.market
    }
    public fun orig_sz(p0: &Order): u64 {
        assert!(p0 is V1, 14566554180833181697);
        *&p0.orig_sz
    }
    public fun sz(p0: &Order): u64 {
        assert!(p0 is V1, 14566554180833181697);
        *&p0.sz
    }
    public fun px(p0: &Order): u64 {
        assert!(p0 is V1, 14566554180833181697);
        *&p0.px
    }
    public fun is_buy(p0: &Order): bool {
        assert!(p0 is V1, 14566554180833181697);
        *&p0.is_buy
    }
    public fun order_type(p0: &Order): u8 {
        assert!(p0 is V1, 14566554180833181697);
        *&p0.order_type
    }
    public fun timestamp(p0: &Order): u64 {
        assert!(p0 is V1, 14566554180833181697);
        *&p0.timestamp
    }
    public fun new_v1(p0: u64, p1: address, p2: address, p3: u64, p4: u64, p5: bool, p6: u8, p7: u64): Order {
        Order::V1{id: p0, user_addr: p1, market: p2, orig_sz: p3, sz: p3, px: p4, is_buy: p5, order_type: p6, timestamp: p7}
    }
    friend fun set_px(p0: &mut Order, p1: u64) {
        assert!(p0 is V1, 14566554180833181697);
        let _v0 = &mut p0.px;
        *_v0 = p1;
    }
    friend fun sub_sz(p0: &mut Order, p1: u64) {
        assert!(p0 is V1, 14566554180833181697);
        let _v0 = &mut p0.sz;
        *_v0 = *_v0 - p1;
    }
}
