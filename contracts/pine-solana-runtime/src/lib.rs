//! Bounded bar evaluator shared by the generated Solana program and host tests.
//! Floating point compatibility is experimental; this is not TradingView's engine.

pub const MAX_NODES: usize = 256;
pub const MAX_CELLS: usize = 900;
// Recursive averages need only constant state, even at the compiler's maximum period.
pub const MAX_PERIOD: usize = 1024;
pub const MAX_ORDERS: usize = 16;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Const, Open, High, Low, Close, Volume, Time, BarIndex,
    Add, Sub, Mul, Div, Mod, Neg, Abs, Min, Max, Floor, Ceil, Round, Sqrt, Sign, CheckedInt,
    IsNa, Nz, Eq, Ne, Lt, Le, Gt, Ge, And, Or, Not, Select,
    History, Persistent, Sma, Ema, Rma, Highest, Lowest, Stdev, Variance, Sum, Wma,
}
#[derive(Clone, Copy, Debug)]
pub struct Node { pub op: Op, pub boolean: bool, pub a: usize, pub b: usize,
    pub c: usize, pub value: f64, pub period: usize }
#[derive(Clone, Copy, Debug)]
pub struct Layout { pub history_offset: usize, pub history_length: usize,
    pub aux_offset: usize, pub aux_length: usize }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderKind { Entry, Close, CloseAll }
#[derive(Clone, Copy, Debug)]
pub struct Order { pub kind: OrderKind, pub id: &'static str, pub side: i8,
    pub condition: usize, pub quantity: Option<usize> }
#[derive(Clone, Copy, Debug)]
pub struct Program<'a> { pub pine_version: u8, pub nodes: &'a [Node],
    pub layouts: &'a [Layout], pub orders: &'a [Order], pub state_cells: usize }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct State { pub bars: u64, pub data: Vec<u64> }
#[derive(Clone, Copy, Debug)]
pub struct Bar { pub open: f64, pub high: f64, pub low: f64, pub close: f64,
    pub volume: f64, pub time: u64 }
#[derive(Clone, Debug, PartialEq)]
pub struct Intent { pub kind: OrderKind, pub id: &'static str, pub side: i8,
    pub quantity: Option<f64>, pub bar_index: u64, pub time: u64 }
#[derive(Clone, Debug)]
pub struct Evaluation { pub values: Vec<f64>, pub intents: Vec<Intent> }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error { InvalidProgram, InvalidLayout, InvalidState, InvalidBar,
    InvalidQuantity, IntegerRange, BarLimit, InvalidClock }

impl State {
    pub fn new(program: &Program<'_>) -> Result<Self, Error> {
        program.validate()?;
        Ok(Self { bars: 0, data: vec![f64::NAN.to_bits(); program.state_cells] })
    }
}
fn clean(x: f64) -> f64 { if x.is_finite() { x } else { f64::NAN } }
fn truth(x: f64) -> bool { x.is_finite() && x != 0.0 }
fn bit(x: bool) -> f64 { if x { 1.0 } else { 0.0 } }
// floor(x + 0.5) misrounds the predecessor of 0.5 and large odd integers.
// Match Math.round: nearest integer, ties toward +Infinity, preserving -0.
fn round_ties_up(x: f64) -> f64 {
    if !x.is_finite() { return x; }
    let lower = libm::floor(x);
    let result = if x - lower < 0.5 { lower } else { lower + 1.0 };
    if result == 0.0 { libm::copysign(0.0, x) } else { result }
}
// At 2^23 the f64 spacing exceeds 1e-9; scaling can lose information but
// rounding to nine fractional decimal places cannot change the value.
fn rounded(x: f64) -> f64 { if libm::fabs(x) >= 8_388_608.0 { x } else { round_ties_up(x * 1e9) / 1e9 } }
fn modulo(left: f64, right: f64) -> f64 {
    if right == 0.0 { return f64::NAN; }
    let remainder = libm::fmod(left, right);
    if remainder != 0.0 && (remainder < 0.0) != (right < 0.0) { remainder + right } else { remainder }
}
fn unary(op: Op) -> bool { matches!(op, Op::Neg|Op::Abs|Op::Floor|Op::Ceil|Op::Round|Op::Sqrt|Op::Sign|Op::CheckedInt|Op::IsNa|Op::Not|Op::History|Op::Sma|Op::Ema|Op::Rma|Op::Highest|Op::Lowest|Op::Stdev|Op::Variance|Op::Sum|Op::Wma) }
fn binary(op: Op) -> bool { matches!(op, Op::Add|Op::Sub|Op::Mul|Op::Div|Op::Mod|Op::Min|Op::Max|Op::Nz|Op::Eq|Op::Ne|Op::Lt|Op::Le|Op::Gt|Op::Ge|Op::And|Op::Or) }
fn periodic(op: Op) -> bool { matches!(op, Op::Sma|Op::Ema|Op::Rma|Op::Highest|Op::Lowest|Op::Stdev|Op::Variance|Op::Sum|Op::Wma) }

impl Program<'_> {
    pub fn validate(&self) -> Result<(), Error> {
        let n = self.nodes.len();
        if n == 0 || n > MAX_NODES || self.layouts.len() != n || self.orders.len() > MAX_ORDERS || self.state_cells > MAX_CELLS || !(4..=6).contains(&self.pine_version) { return Err(Error::InvalidProgram); }
        let mut used = vec![false; self.state_cells];
        for (i, (node, layout)) in self.nodes.iter().zip(self.layouts).enumerate() {
            if node.a >= n || node.b >= n || node.c >= n || node.value.is_infinite() || (node.op != Op::Const && !node.value.is_nan()) { return Err(Error::InvalidProgram); }
            if node.op == Op::Const && node.boolean && node.value != 0.0 && node.value != 1.0 && !(self.pine_version < 6 && node.value.is_nan()) { return Err(Error::InvalidProgram); }
            if ((unary(node.op) && node.op != Op::History) || binary(node.op) || node.op == Op::Select) && node.a >= i { return Err(Error::InvalidProgram); }
            // A variable's historical value is its final committed value, which may
            // be written by a later node. Only current-bar dependencies must be a DAG.
            if node.op == Op::History && (node.a >= n || (node.period == 0 && node.a >= i)) { return Err(Error::InvalidProgram); }
            if (binary(node.op) || node.op == Op::Select || node.op == Op::Persistent || node.op == Op::CheckedInt) && node.b >= i { return Err(Error::InvalidProgram); }
            if node.op == Op::Select && node.c >= i { return Err(Error::InvalidProgram); }
            if node.op == Op::Persistent && (node.a >= n || self.layouts[node.a].history_length < 1) { return Err(Error::InvalidProgram); }
            if node.period > MAX_PERIOD || (periodic(node.op) && node.period == 0) || (!periodic(node.op) && node.op != Op::History && node.period != 0) { return Err(Error::InvalidProgram); }
            let a_bool = self.nodes[node.a].boolean;
            let b_bool = self.nodes[node.b].boolean;
            let c_bool = self.nodes[node.c].boolean;
            let type_valid = match node.op {
                Op::Const => true,
                Op::Open|Op::High|Op::Low|Op::Close|Op::Volume|Op::Time|Op::BarIndex => !node.boolean,
                Op::Add|Op::Sub|Op::Mul|Op::Div|Op::Mod|Op::Min|Op::Max => !node.boolean && !a_bool && !b_bool,
                Op::Neg|Op::Abs|Op::Floor|Op::Ceil|Op::Round|Op::Sqrt|Op::Sign|Op::Sma|Op::Ema|Op::Rma|Op::Highest|Op::Lowest|Op::Stdev|Op::Variance|Op::Sum|Op::Wma => !node.boolean && !a_bool,
                Op::CheckedInt => !node.boolean && !a_bool && b_bool,
                Op::Eq|Op::Ne|Op::Lt|Op::Le|Op::Gt|Op::Ge => node.boolean && a_bool == b_bool,
                Op::And|Op::Or => node.boolean && a_bool && b_bool,
                Op::Not => node.boolean && a_bool,
                Op::IsNa => node.boolean,
                Op::Nz|Op::Persistent => node.boolean == a_bool && node.boolean == b_bool,
                // A numeric condition is an internal explicit truth conversion.
                Op::Select => node.boolean == b_bool && node.boolean == c_bool,
                Op::History => node.boolean == a_bool,
            };
            if !type_valid { return Err(Error::InvalidProgram); }
            if node.op == Op::History && self.layouts[node.a].history_length < node.period { return Err(Error::InvalidLayout); }
            if matches!(node.op,Op::Highest|Op::Lowest|Op::Sum) && self.layouts[node.a].history_length < node.period - 1 { return Err(Error::InvalidLayout); }
            if matches!(node.op,Op::Ema|Op::Rma) && layout.history_length < 1 { return Err(Error::InvalidLayout); }
            let aux = match node.op { Op::Sma|Op::Wma|Op::Stdev|Op::Variance => node.period + 2, Op::Rma=>2, _=>0 };
            if layout.aux_length != aux { return Err(Error::InvalidLayout); }
            for (offset,len) in [(layout.history_offset,layout.history_length),(layout.aux_offset,layout.aux_length)] {
                let end = offset.checked_add(len).ok_or(Error::InvalidLayout)?;
                if end > self.state_cells { return Err(Error::InvalidLayout); }
                for cell in &mut used[offset..end] { if *cell { return Err(Error::InvalidLayout); } *cell=true; }
            }
        }
        if used.iter().any(|x| !x) { return Err(Error::InvalidLayout); }
        for order in self.orders {
            if order.condition >= n || !self.nodes[order.condition].boolean || order.id.len()>64 { return Err(Error::InvalidProgram); }
            if order.kind == OrderKind::Entry {
                if ![-1,1].contains(&order.side) || order.quantity.is_none() { return Err(Error::InvalidProgram); }
            } else if order.side != 0 || order.quantity.is_some() || (order.kind == OrderKind::CloseAll && !order.id.is_empty()) { return Err(Error::InvalidProgram); }
            if let Some(q) = order.quantity { if q>=n || self.nodes[q].boolean { return Err(Error::InvalidProgram); } }
        }
        Ok(())
    }
    fn validate_state(&self, state: &State) -> Result<(), Error> {
        if state.data.len() != self.state_cells || state.data.iter().any(|bits| f64::from_bits(*bits).is_infinite()) { return Err(Error::InvalidState); }
        for (node, layout) in self.nodes.iter().zip(self.layouts) {
            for k in 0..layout.history_length {
                let value = f64::from_bits(state.data[layout.history_offset + k]);
                let written = state.bars >= layout.history_length as u64 || (k as u64) < state.bars;
                if !written && !value.is_nan() { return Err(Error::InvalidState); }
                if written && node.boolean && value != 0.0 && value != 1.0 && !(self.pine_version < 6 && value.is_nan()) { return Err(Error::InvalidState); }
            }
            if matches!(node.op, Op::Sma|Op::Wma|Op::Stdev|Op::Variance) {
                let base = layout.aux_offset;
                if state.bars == 0 {
                    if state.data[base..base+layout.aux_length].iter().any(|bits| !f64::from_bits(*bits).is_nan()) { return Err(Error::InvalidState); }
                    continue;
                }
                let count = f64::from_bits(state.data[base]);
                let head = f64::from_bits(state.data[base+1]);
                if !count.is_finite() || count < 0.0 || count > (node.period as u64).min(state.bars) as f64 || libm::floor(count) != count || !head.is_finite() || head < 0.0 || head >= node.period as f64 || libm::floor(head) != head || (count < node.period as f64 && head != count) { return Err(Error::InvalidState); }
                for k in 0..node.period {
                    let sample = f64::from_bits(state.data[base+2+k]);
                    if if k < count as usize { !sample.is_finite() } else { !sample.is_nan() } { return Err(Error::InvalidState); }
                }
            } else if node.op == Op::Rma {
                let count = f64::from_bits(state.data[layout.aux_offset]);
                let sum = f64::from_bits(state.data[layout.aux_offset+1]);
                let previous = if state.bars == 0 { f64::NAN } else { f64::from_bits(state.data[layout.history_offset + ((state.bars-1) % layout.history_length as u64) as usize]) };
                if count.is_nan() {
                    if !sum.is_nan() || !previous.is_nan() { return Err(Error::InvalidState); }
                } else if !count.is_finite() || libm::floor(count) != count || count < 1.0 || count > (node.period as u64).min(state.bars) as f64 || !sum.is_finite() || (if count < node.period as f64 { !previous.is_nan() } else { !previous.is_finite() }) { return Err(Error::InvalidState); }
            }
        }
        Ok(())
    }
    fn historical(&self, source:usize, offset:usize, state:&State) -> f64 {
        if state.bars < offset as u64 { return if self.pine_version >= 6 && self.nodes[source].boolean { 0.0 } else { f64::NAN }; }
        let l=self.layouts[source];
        f64::from_bits(state.data[l.history_offset + ((state.bars-offset as u64) % l.history_length as u64) as usize])
    }
    pub fn evaluate(&self, state:&mut State, bar:Bar) -> Result<Evaluation,Error> {
        self.validate()?;
        if state.bars >= MAX_SAFE_INTEGER { return Err(Error::BarLimit); }
        self.validate_state(state)?;
        validate_bar(&bar)?;
        // Copy before any write, including TA seed cells. Errors never advance state.
        let mut next=state.clone();
        let mut values=Vec::with_capacity(self.nodes.len());
        for (i,node) in self.nodes.iter().enumerate() {
            let a=values.get(node.a).copied().unwrap_or(f64::NAN);
            let b=values.get(node.b).copied().unwrap_or(f64::NAN);
            let c=values.get(node.c).copied().unwrap_or(f64::NAN);
            let nullable=|| if self.pine_version >= 6 {0.0} else {f64::NAN};
            let value=match node.op {
                Op::Const=>node.value, Op::Open=>bar.open, Op::High=>bar.high,
                Op::Low=>bar.low, Op::Close=>bar.close, Op::Volume=>bar.volume,
                Op::Time=>bar.time as f64, Op::BarIndex=>state.bars as f64,
                Op::Add=>a+b, Op::Sub=>a-b, Op::Mul=>a*b,
                Op::Div=>if b==0.0 {f64::NAN} else {a/b},
                Op::Mod=>modulo(a,b),
                Op::Neg=>-a, Op::Abs=>libm::fabs(a),
                Op::Min=>if a.is_nan()||b.is_nan(){f64::NAN}else{a.min(b)},
                Op::Max=>if a.is_nan()||b.is_nan(){f64::NAN}else{a.max(b)},
                Op::Floor=>libm::floor(a), Op::Ceil=>libm::ceil(a),
                Op::Round=>round_ties_up(a), Op::Sqrt=>libm::sqrt(a),
                Op::Sign=>if a.is_nan(){f64::NAN}else if a>0.0 {1.0}else if a<0.0 {-1.0}else{0.0},
                Op::CheckedInt=>{
                    if !truth(b) { f64::NAN } else {
                        if !a.is_nan() && (!a.is_finite() || libm::floor(a)!=a || libm::fabs(a)>MAX_SAFE_INTEGER as f64) { return Err(Error::IntegerRange); }
                        a
                    }
                },
                Op::IsNa=>bit(a.is_nan()), Op::Nz=>if a.is_nan(){b}else{a},
                Op::Eq|Op::Ne|Op::Lt|Op::Le|Op::Gt|Op::Ge=>{
                    if a.is_nan()||b.is_nan(){nullable()}else{ let(x,y)=(rounded(a),rounded(b));
                        bit(match node.op {Op::Eq=>x==y,Op::Ne=>x!=y,Op::Lt=>x<y,Op::Le=>x<=y,Op::Gt=>x>y,_=>x>=y})}
                },
                Op::And=>if a==0.0||b==0.0{0.0}else if a.is_nan()||b.is_nan(){nullable()}else{1.0},
                Op::Or=>if truth(a)||truth(b){1.0}else if a.is_nan()||b.is_nan(){nullable()}else{0.0},
                Op::Not=>if a.is_nan()&&self.pine_version<6{f64::NAN}else{bit(!truth(a))},
                Op::Select=>if truth(a){b}else{c},
                Op::History=>if node.period==0{a}else{self.historical(node.a,node.period,state)},
                Op::Persistent=>if state.bars==0{b}else{self.historical(node.a,1,state)},
                Op::Ema=>{let prev=self.historical(i,1,state);let alpha=2.0/(node.period as f64+1.0);
                    if a.is_nan(){prev}else if prev.is_nan(){a}else{alpha*a+(1.0-alpha)*prev}},
                Op::Rma=>{let prev=self.historical(i,1,state);let l=self.layouts[i];
                    if a.is_nan(){prev}else if prev.is_finite(){
                        let result=a/node.period as f64+(1.0-1.0/node.period as f64)*prev;
                        if !result.is_finite() { return Err(Error::InvalidState); }
                        result
                    }
                    else{let count=f64::from_bits(next.data[l.aux_offset]);let sum=f64::from_bits(next.data[l.aux_offset+1]);
                        let count=if count.is_nan(){1.0}else{count+1.0};let sum=if sum.is_nan(){a}else{sum+a};
                        if !sum.is_finite() || !count.is_finite() || count < 1.0 || count > node.period as f64 { return Err(Error::InvalidState); }
                        next.data[l.aux_offset]=count.to_bits();next.data[l.aux_offset+1]=sum.to_bits();
                        if count>=node.period as f64{sum/node.period as f64}else{f64::NAN}}},
                Op::Highest|Op::Lowest|Op::Sum=>{let mut result=f64::NAN;
                    for k in (0..node.period).rev(){let x=if k==0{a}else{self.historical(node.a,k,state)};
                        if node.op==Op::Sum {if x.is_nan(){result=f64::NAN;break;} result=if result.is_nan(){x}else{result+x};}
                        else if x.is_finite(){result=if result.is_nan(){x}else if node.op==Op::Highest {result.max(x)}else{result.min(x)};}}
                    result},
                Op::Sma|Op::Wma|Op::Variance|Op::Stdev=>{
                    let l=self.layouts[i];
                    let count_v=f64::from_bits(next.data[l.aux_offset]);let head_v=f64::from_bits(next.data[l.aux_offset+1]);
                    if (!count_v.is_nan() && (!count_v.is_finite()||count_v<0.0||count_v>node.period as f64||libm::floor(count_v)!=count_v)) || (!head_v.is_nan() && (!head_v.is_finite()||head_v<0.0||head_v>=node.period as f64||libm::floor(head_v)!=head_v)) {return Err(Error::InvalidState);}
                    let mut count=if count_v.is_nan(){0}else{count_v as usize};
                    let mut head=if head_v.is_nan(){0}else{head_v as usize};
                    if a.is_finite(){next.data[l.aux_offset+2+head]=a.to_bits();head=(head+1)%node.period;count=(count+1).min(node.period);}
                    next.data[l.aux_offset]=(count as f64).to_bits();next.data[l.aux_offset+1]=(head as f64).to_bits();
                    if count<node.period{f64::NAN}else{
                        let sample=|k:usize|f64::from_bits(next.data[l.aux_offset+2+(head+k)%node.period]);
                        let mut sum=0.0;for k in 0..node.period{sum+=sample(k);}let mean=sum/node.period as f64;
                        match node.op{Op::Sma=>mean,Op::Wma=>{let mut s=0.0;for k in 0..node.period{s+=sample(k)*(k+1) as f64;}s/(node.period*(node.period+1)/2) as f64},
                            _=>{let mut variance=0.0;for k in 0..node.period{let d=sample(k)-mean;variance+=d*d;}variance/=node.period as f64;if node.op==Op::Stdev{libm::sqrt(variance)}else{variance}}}
                    }
                }
            };
            values.push(clean(value));
        }
        let mut intents=Vec::with_capacity(self.orders.len());
        for order in self.orders {
            if !truth(values[order.condition]){continue;}
            let quantity=order.quantity.map(|q|values[q]);
            if order.kind==OrderKind::Entry && !quantity.map(|q|q.is_finite()&&q>0.0).unwrap_or(false){return Err(Error::InvalidQuantity);}
            intents.push(Intent{kind:order.kind,id:order.id,side:order.side,quantity,bar_index:state.bars,time:bar.time});
        }
        for (i,l) in self.layouts.iter().enumerate(){if l.history_length>0{next.data[l.history_offset+(state.bars%l.history_length as u64) as usize]=values[i].to_bits();}}
        next.bars+=1;
        *state=next;
        Ok(Evaluation{values,intents})
    }
}

pub fn validate_bar(bar:&Bar)->Result<(),Error>{
    if ![bar.open,bar.high,bar.low,bar.close,bar.volume].iter().all(|x|x.is_finite()) || bar.volume<0.0 || bar.low>bar.open.min(bar.close) || bar.high<bar.open.max(bar.close) || bar.high<bar.low || bar.time>MAX_SAFE_INTEGER {return Err(Error::InvalidBar);} Ok(())
}
/// The caller authenticates the feed. All timestamps are milliseconds.
/// Every candle covers [time,time+timeframe), so only finalized candles are accepted.
pub fn validate_clock(origin:u64,bars:u64,timeframe_ms:u64,time:u64,now:u64)->Result<(),Error>{
    if timeframe_ms==0 || timeframe_ms>MAX_SAFE_INTEGER || origin>MAX_SAFE_INTEGER || time>MAX_SAFE_INTEGER {return Err(Error::InvalidClock);}
    let expected=bars.checked_mul(timeframe_ms).and_then(|x|origin.checked_add(x)).ok_or(Error::InvalidClock)?;
    let close=time.checked_add(timeframe_ms).ok_or(Error::InvalidClock)?;
    if time!=expected || close>now {return Err(Error::InvalidClock);} Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn node(op:Op,a:usize,period:usize)->Node{Node{op,boolean:false,a,b:0,c:0,value:f64::NAN,period}}
    fn bar(c:f64,t:u64)->Bar{Bar{open:c,high:c,low:c,close:c,volume:0.0,time:t}}
    fn layout(h:usize,n:usize,a:usize,len:usize)->Layout{Layout{history_offset:h,history_length:n,aux_offset:a,aux_length:len}}
    #[test]fn zero_is_not_missing_and_history_is_bar_relative(){
        let nodes=[node(Op::Close,0,0),node(Op::History,0,1)];let ls=[layout(0,1,0,0),layout(0,0,0,0)];let p=Program{pine_version:6,nodes:&nodes,layouts:&ls,orders:&[],state_cells:1};let mut s=State::new(&p).unwrap();
        assert!(p.evaluate(&mut s,bar(0.0,0)).unwrap().values[1].is_nan());assert_eq!(p.evaluate(&mut s,bar(2.0,1)).unwrap().values[1],0.0);
    }
    #[test]fn ema_and_rma_seed_differ(){
        let ns=[node(Op::Close,0,0),node(Op::Ema,0,3),node(Op::Rma,0,3)];let ls=[layout(0,0,0,0),layout(0,1,0,0),layout(1,1,2,2)];let p=Program{pine_version:6,nodes:&ns,layouts:&ls,orders:&[],state_cells:4};let mut s=State::new(&p).unwrap();
        let e=p.evaluate(&mut s,bar(2.0,0)).unwrap();assert_eq!(e.values[1],2.0);assert!(e.values[2].is_nan());p.evaluate(&mut s,bar(4.0,1)).unwrap();let e=p.evaluate(&mut s,bar(6.0,2)).unwrap();assert_eq!(e.values[1],4.5);assert_eq!(e.values[2],4.0);
    }
    #[test]
    fn ema_and_rma_accept_1024_period_without_window_sized_state() {
        let nodes = [node(Op::Close, 0, 0), node(Op::Ema, 0, 1024), node(Op::Rma, 0, 1024)];
        let layouts = [layout(0, 0, 0, 0), layout(0, 1, 0, 0), layout(1, 1, 2, 2)];
        let program = Program { pine_version: 6, nodes: &nodes, layouts: &layouts, orders: &[], state_cells: 4 };
        let mut state = State::new(&program).unwrap();
        assert_eq!(state.data.len(), 4);
        for index in 0..1024 {
            let result = program.evaluate(&mut state, bar(8.0, index)).unwrap();
            assert!((result.values[1] - 8.0).abs() < 1e-12);
            if index < 1023 {
                assert!(result.values[2].is_nan(), "RMA must wait for all 1024 seed samples");
            } else {
                assert_eq!(result.values[2], 8.0);
            }
            assert_eq!(state.data.len(), 4);
        }
        let result = program.evaluate(&mut state, bar(24.0, 1024)).unwrap();
        assert!((result.values[1] - (8.0 + 32.0 / 1025.0)).abs() < 1e-12);
        assert_eq!(result.values[2], 8.015625);
        assert_eq!(state.bars, 1025);
        assert_eq!(state.data.len(), 4);
    }
    #[test]
    fn ema_and_rma_reject_1025_period_before_mutating_state() {
        for op in [Op::Ema, Op::Rma] {
            let nodes = [node(Op::Close, 0, 0), node(op, 0, 1025)];
            let aux_length = if op == Op::Rma { 2 } else { 0 };
            let layouts = [layout(0, 0, 0, 0), layout(0, 1, 1, aux_length)];
            let program = Program { pine_version: 6, nodes: &nodes, layouts: &layouts, orders: &[], state_cells: 1 + aux_length };
            assert_eq!(State::new(&program).unwrap_err(), Error::InvalidProgram);
            let mut state = State { bars: 0, data: vec![f64::NAN.to_bits(); program.state_cells] };
            let before = state.clone();
            assert_eq!(program.evaluate(&mut state, bar(8.0, 0)).unwrap_err(), Error::InvalidProgram);
            assert_eq!(state, before);
        }
    }
    #[test]fn averages_ignore_na_and_require_full_seed(){
        let mut zero=node(Op::Const,0,0);zero.value=0.0;
        let ns=[node(Op::Close,0,0),zero,Node{op:Op::Div,a:0,b:0,..node(Op::Div,0,0)},node(Op::Sma,2,2),node(Op::Wma,2,2)];let ls=[layout(0,0,0,0),layout(0,0,0,0),layout(0,0,0,0),layout(0,0,0,4),layout(0,0,4,4)];let p=Program{pine_version:6,nodes:&ns,layouts:&ls,orders:&[],state_cells:8};let mut s=State::new(&p).unwrap();
        assert!(p.evaluate(&mut s,bar(2.0,0)).unwrap().values[3].is_nan());assert!(p.evaluate(&mut s,bar(0.0,1)).unwrap().values[3].is_nan());let e=p.evaluate(&mut s,bar(3.0,2)).unwrap();assert_eq!(e.values[3],1.0);assert_eq!(e.values[4],1.0);
    }
    #[test]fn failed_order_does_not_commit_ta_or_history(){
        let mut cond=node(Op::Const,0,0);cond.boolean=true;cond.value=1.0;let mut qty=node(Op::Const,0,0);qty.value=-1.0;
        let ns=[node(Op::Close,0,0),node(Op::Sma,0,2),cond,qty];let ls=[layout(0,1,0,0),layout(0,0,1,4),layout(0,0,0,0),layout(0,0,0,0)];let orders=[Order{kind:OrderKind::Entry,id:"L",side:1,condition:2,quantity:Some(3)}];let p=Program{pine_version:6,nodes:&ns,layouts:&ls,orders:&orders,state_cells:5};let mut s=State::new(&p).unwrap();let before=s.clone();assert_eq!(p.evaluate(&mut s,bar(3.0,0)).unwrap_err(),Error::InvalidQuantity);assert_eq!(s,before);
    }
    #[test]fn finalized_clock_rejects_replays_skips_and_future(){assert!(validate_clock(0,2,60_000,120_000,180_000).is_ok());assert_eq!(validate_clock(0,2,60_000,60_000,180_000),Err(Error::InvalidClock));assert_eq!(validate_clock(0,2,60_000,180_000,240_000),Err(Error::InvalidClock));assert_eq!(validate_clock(0,2,60_000,120_000,179_999),Err(Error::InvalidClock));}
    #[test]fn invalid_ohlcv_is_atomic(){let ns=[node(Op::Close,0,0)];let ls=[layout(0,0,0,0)];let p=Program{pine_version:6,nodes:&ns,layouts:&ls,orders:&[],state_cells:0};let mut s=State::new(&p).unwrap();let before=s.clone();let mut b=bar(3.0,0);b.low=4.0;assert_eq!(p.evaluate(&mut s,b).unwrap_err(),Error::InvalidBar);assert_eq!(s,before);}
    #[test]fn malformed_layout_returns_error_without_panic(){let ns=[node(Op::Close,0,0),node(Op::History,0,1)];let ls=[layout(0,0,0,0),layout(0,0,0,0)];let p=Program{pine_version:6,nodes:&ns,layouts:&ls,orders:&[],state_cells:0};assert_eq!(State::new(&p).unwrap_err(),Error::InvalidLayout);}

    #[test]
    fn nearest_rounding_has_exact_boundary_results() {
        // Hand-selected nearest-integer expectations, independent of the TS engine.
        let cases = [
            (0.49999999999999994, 0.0), (0.5, 1.0), (0.5000000000000001, 1.0),
            (-0.49999999999999994, -0.0), (-0.5, -0.0), (-0.5000000000000001, -1.0),
            (4_503_599_627_370_497.0, 4_503_599_627_370_497.0),
            (-4_503_599_627_370_497.0, -4_503_599_627_370_497.0),
            (f64::MAX, f64::MAX),
        ];
        let nodes = [node(Op::Close, 0, 0), node(Op::Round, 0, 0)];
        let layouts = [layout(0, 0, 0, 0); 2];
        let program = Program { pine_version: 6, nodes: &nodes, layouts: &layouts, orders: &[], state_cells: 0 };
        let mut state = State::new(&program).unwrap();
        for (index, (value, expected)) in cases.into_iter().enumerate() {
            let got = program.evaluate(&mut state, bar(value, index as u64)).unwrap().values[1];
            assert_eq!(got.to_bits(), expected.to_bits(), "round({value})");
        }
    }

    #[test]
    fn comparison_precision_does_not_destroy_large_distinct_values() {
        for value in [8_388_608.000000019, 8_388_608.00000002, 1e307, 1e308] {
            assert_eq!(rounded(value), value);
        }
        assert_eq!(rounded(0.49999999999999994 / 1e9), 0.0);
        assert_eq!(rounded(0.5 / 1e9), 1e-9);
    }

    #[test]
    fn malformed_node_types_and_order_shapes_are_rejected() {
        let mut yes = node(Op::Const, 0, 0); yes.boolean = true; yes.value = 1.0;
        let originals = [node(Op::Close, 0, 0), node(Op::Abs, 0, 0), yes];
        let layouts = [layout(0, 0, 0, 0); 3];
        for (index, invalid) in [
            (0, Node { boolean: true, ..originals[0] }),
            (1, Node { a: 2, ..originals[1] }),
            (1, Node { period: 1, ..originals[1] }),
            (1, Node { b: usize::MAX, ..originals[1] }),
            (2, Node { value: 2.0, ..originals[2] }),
            (2, Node { value: f64::NAN, ..originals[2] }),
        ] {
            let mut nodes = originals; nodes[index] = invalid;
            let program = Program { pine_version: 6, nodes: &nodes, layouts: &layouts, orders: &[], state_cells: 0 };
            assert_eq!(State::new(&program).unwrap_err(), Error::InvalidProgram);
        }
        let close = Order { kind: OrderKind::CloseAll, id: "", side: 0, condition: 2, quantity: None };
        for invalid in [
            Order { side: 1, ..close }, Order { quantity: Some(0), ..close },
            Order { id: "unrelated", ..close }, Order { condition: 0, ..close },
            Order { kind: OrderKind::Entry, ..close },
        ] {
            let orders = [invalid];
            let program = Program { pine_version: 6, nodes: &originals, layouts: &layouts, orders: &orders, state_cells: 0 };
            assert_eq!(State::new(&program).unwrap_err(), Error::InvalidProgram);
        }
    }

    #[test]
    fn malformed_window_state_is_rejected_atomically() {
        let nodes = [node(Op::Close, 0, 0), node(Op::Sma, 0, 3)];
        let layouts = [layout(0, 0, 0, 0), layout(0, 0, 0, 5)];
        let program = Program { pine_version: 6, nodes: &nodes, layouts: &layouts, orders: &[], state_cells: 5 };
        let mut good = State::new(&program).unwrap();
        program.evaluate(&mut good, bar(1.0, 0)).unwrap();
        for (offset, value) in [(0, 1.5_f64), (0, -1.0), (0, 3.0), (1, 1.5), (1, -1.0), (1, 3.0), (1, 0.0), (2, f64::NAN), (3, 99.0), (2, f64::INFINITY)] {
            let mut bad = good.clone(); bad.data[offset] = value.to_bits();
            let before = bad.clone();
            assert_eq!(program.evaluate(&mut bad, bar(2.0, 1)).unwrap_err(), Error::InvalidState);
            assert_eq!(bad, before);
        }
    }

    #[test]
    fn malformed_rma_seed_is_rejected_atomically() {
        let nodes = [node(Op::Close, 0, 0), node(Op::Rma, 0, 3)];
        let layouts = [layout(0, 0, 0, 0), layout(0, 1, 1, 2)];
        let program = Program { pine_version: 6, nodes: &nodes, layouts: &layouts, orders: &[], state_cells: 3 };
        let mut good = State::new(&program).unwrap();
        program.evaluate(&mut good, bar(1.0, 0)).unwrap();
        for count in [-1.0_f64, 0.0, 0.5, 2.0, 4.0, f64::NAN] {
            let mut bad = good.clone(); bad.data[1] = count.to_bits();
            let before = bad.clone();
            assert_eq!(program.evaluate(&mut bad, bar(2.0, 1)).unwrap_err(), Error::InvalidState);
            assert_eq!(bad, before);
        }
        let mut bad = good.clone(); bad.data[0] = 1.0_f64.to_bits();
        let before = bad.clone();
        assert_eq!(program.evaluate(&mut bad, bar(2.0, 1)).unwrap_err(), Error::InvalidState);
        assert_eq!(bad, before);
    }

    #[test]
    fn checked_integers_reject_range_errors_atomically_and_can_continue() {
        let mut yes = node(Op::Const, 0, 0); yes.boolean = true; yes.value = 1.0;
        let nodes = [yes, node(Op::Close, 0, 0), node(Op::Sma, 1, 2), node(Op::Floor, 1, 0), node(Op::CheckedInt, 3, 0)];
        let layouts = [layout(0, 0, 0, 0), layout(0, 0, 0, 0), layout(0, 0, 0, 4), layout(0, 0, 0, 0), layout(0, 0, 0, 0)];
        let program = Program { pine_version: 6, nodes: &nodes, layouts: &layouts, orders: &[], state_cells: 4 };
        let mut state = State::new(&program).unwrap();
        assert_eq!(program.evaluate(&mut state, bar(3.5, 0)).unwrap().values[4], 3.0);
        let before = state.clone();
        for value in [1e16, -1e16, MAX_SAFE_INTEGER as f64 + 1.0] {
            assert_eq!(program.evaluate(&mut state, bar(value, 1)).unwrap_err(), Error::IntegerRange);
            assert_eq!(state, before);
        }
        let continued = program.evaluate(&mut state, bar(4.5, 1)).unwrap();
        assert_eq!(continued.values[2], 4.0);
        assert_eq!(continued.values[4], 4.0);
        assert_eq!(state.bars, 2);
        for value in [MAX_SAFE_INTEGER as f64, -(MAX_SAFE_INTEGER as f64)] {
            assert_eq!(program.evaluate(&mut state, bar(value, 2)).unwrap().values[4], value);
        }
    }

    #[test]
    fn checked_integers_preserve_missing_and_skip_inactive_guards() {
        for enabled in [true, false] {
            let mut guard = node(Op::Const, 0, 0); guard.boolean = true; guard.value = bit(enabled);
            let source = if enabled { node(Op::Const, 0, 0) } else { node(Op::Close, 0, 0) };
            let nodes = [guard, source, node(Op::CheckedInt, 1, 0)];
            let layouts = [layout(0, 0, 0, 0); 3];
            let program = Program { pine_version: 6, nodes: &nodes, layouts: &layouts, orders: &[], state_cells: 0 };
            let mut state = State::new(&program).unwrap();
            assert!(program.evaluate(&mut state, bar(1e16, 0)).unwrap().values[2].is_nan());
            let mut malformed = nodes; malformed[2].b = 1;
            let bad = Program { nodes: &malformed, ..program };
            assert_eq!(State::new(&bad).unwrap_err(), Error::InvalidProgram);
        }
    }

    #[test]
    fn modulo_avoids_inexact_and_overflowing_products() {
        for (left, right, expected) in [
            (-(MAX_SAFE_INTEGER as f64), 3.0, 2.0),
            (MAX_SAFE_INTEGER as f64, -3.0, -2.0),
            (-(MAX_SAFE_INTEGER as f64), -3.0, -1.0),
            (-10.0, 3.0, 2.0), (10.0, -3.0, -2.0),
            (f64::MAX, 3.0, 2.0),
        ] { assert_eq!(modulo(left, right), expected, "{left} % {right}"); }
        assert!(modulo(1.0, 0.0).is_nan());
    }
}
